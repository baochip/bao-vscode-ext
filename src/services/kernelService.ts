import * as fs from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import { runBaoCmd } from '@services/pathService';
import { getGlobalVenvRoot } from '@services/uvService';
import * as vscode from 'vscode';

export type KernelMode = 'ci-sync' | 'ci-only' | 'manual';

const KERNEL_MODE_KEY = 'baochip.outOfTree.kernelMode';

function getSavedKernelMode(): string {
	return vscode.workspace.getConfiguration('').get<string>(KERNEL_MODE_KEY) ?? 'ask';
}

async function saveKernelMode(mode: KernelMode): Promise<void> {
	await vscode.workspace
		.getConfiguration('')
		.update(KERNEL_MODE_KEY, mode, vscode.ConfigurationTarget.Workspace);
}

const GITHUB_API_COMMITS = 'https://api.github.com/repos/betrusted-io/xous-core/commits/dev';
const CI_BASE = 'https://ci.betrusted.io/latest-ci/baochip/dabao';
const KERNEL_FILES = ['loader.uf2', 'xous.uf2'] as const;
const KERNEL_FILES_PATH_KEY = 'baochip.outOfTree.kernelFilesPath';

function fetchJson(url: string): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const req = https.get(url, { headers: { 'User-Agent': 'bao-vscode-ext' } }, (res) => {
			let data = '';
			res.on('data', (chunk: Buffer) => {
				data += chunk.toString();
			});
			res.on('end', () => {
				try {
					resolve(JSON.parse(data));
				} catch {
					reject(new Error(`Failed to parse response from ${url}`));
				}
			});
		});
		req.on('error', reject);
		req.setTimeout(10000, () => {
			req.destroy();
			reject(new Error(vscode.l10n.t('GitHub API request timed out.')));
		});
	});
}

/**
 * Fetches the latest xous-core commit hash from the GitHub API.
 * Throws on network error or unexpected response.
 */
export async function fetchLatestXousCoreRev(): Promise<string> {
	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Fetching latest xous-core rev…'),
			cancellable: false,
		},
		async () => {
			const data = (await fetchJson(GITHUB_API_COMMITS)) as Record<string, unknown>;
			const sha = data?.sha;
			if (typeof sha !== 'string' || sha.length < 7) {
				throw new Error(vscode.l10n.t('Unexpected response from GitHub API.'));
			}
			return sha;
		},
	);
}

function downloadFile(url: string, dest: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const file = fs.createWriteStream(dest);
		https
			.get(url, { headers: { 'User-Agent': 'bao-vscode-ext' } }, (res) => {
				if (res.statusCode !== 200) {
					file.close();
					try {
						fs.unlinkSync(dest);
					} catch {}
					reject(new Error(`HTTP ${res.statusCode} for ${url}`));
					return;
				}
				res.pipe(file);
				file.on('finish', () => file.close(() => resolve()));
				file.on('error', (err) => {
					file.close();
					try {
						fs.unlinkSync(dest);
					} catch {}
					reject(err);
				});
			})
			.on('error', reject);
	});
}

async function downloadKernelFiles(cacheDir: string): Promise<void> {
	fs.mkdirSync(cacheDir, { recursive: true });
	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Downloading kernel files…'),
			cancellable: false,
		},
		async () => {
			for (const file of KERNEL_FILES) {
				await downloadFile(`${CI_BASE}/${file}`, path.join(cacheDir, file));
			}
		},
	);
}

/**
 * Resolves the paths to loader.uf2 and xous.uf2 for out-of-tree flashing.
 * Downloads from CI if needed (ci-sync / ci-only), or reads from the user's folder (manual).
 * Returns null on failure.
 */
export async function resolveKernelFiles(): Promise<{ loader: string; xous: string } | null> {
	const mode = getSavedKernelMode() as KernelMode;

	if (mode === 'manual') {
		const folder = vscode.workspace.getConfiguration('').get<string>(KERNEL_FILES_PATH_KEY) || '';
		if (!folder) {
			vscode.window.showErrorMessage(
				vscode.l10n.t(
					'No kernel files folder configured. Set baochip.outOfTree.kernelFilesPath in Settings.',
				),
			);
			return null;
		}
		const loader = path.join(folder, 'loader.uf2');
		const xous = path.join(folder, 'xous.uf2');
		if (!fs.existsSync(loader) || !fs.existsSync(xous)) {
			vscode.window.showErrorMessage(
				vscode.l10n.t(
					'Kernel files not found in {0}. Ensure loader.uf2 and xous.uf2 are present.',
					folder,
				),
			);
			return null;
		}
		return { loader, xous };
	}

	// ci-sync or ci-only: use cached files, downloading if not yet present
	const cacheDir = path.join(getGlobalVenvRoot(), 'kernel');
	const loader = path.join(cacheDir, 'loader.uf2');
	const xous = path.join(cacheDir, 'xous.uf2');

	if (!fs.existsSync(loader) || !fs.existsSync(xous)) {
		try {
			await downloadKernelFiles(cacheDir);
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			vscode.window.showErrorMessage(
				vscode.l10n.t('Baochip: Failed to download kernel files.\n{0}', message),
			);
			return null;
		}
	}

	return { loader, xous };
}

/**
 * Ensures the user has configured how kernel/loader files are sourced.
 * Shows a one-time popup if the setting is still "ask".
 * Returns the resolved KernelMode, or undefined if the user cancelled.
 */
export async function ensureKernelModeConfigured(): Promise<KernelMode | undefined> {
	const saved = getSavedKernelMode();
	if (saved !== 'ask') return saved as KernelMode;

	type Item = vscode.QuickPickItem & { mode: KernelMode };

	const items: Item[] = [
		{
			label: vscode.l10n.t('Sync to latest'),
			description: 'ci-sync',
			detail: vscode.l10n.t(
				'Fetches the latest xous-core commit from GitHub and updates your Cargo.toml rev to match, then downloads the matching loader.uf2 and xous.uf2 from CI. App and kernel are guaranteed to be from the same commit.',
			),
			mode: 'ci-sync',
		},
		{
			label: vscode.l10n.t('Use CI kernel, keep my rev'),
			description: 'ci-only',
			detail: vscode.l10n.t(
				'Downloads the latest loader.uf2 and xous.uf2 from CI. Does NOT change your Cargo.toml rev. You are responsible for ensuring compatibility between your pinned rev and the CI kernel.',
			),
			mode: 'ci-only',
		},
		{
			label: vscode.l10n.t('Manage my own files'),
			description: 'manual',
			detail: vscode.l10n.t(
				'Uses loader.uf2 and xous.uf2 from a folder you specify. Does NOT change your Cargo.toml rev. You are responsible for ensuring those files match your pinned rev.',
			),
			mode: 'manual',
		},
	];

	const picked = await vscode.window.showQuickPick(items, {
		title: vscode.l10n.t('Set Up Kernel Files for Out-of-Tree Build'),
		placeHolder: vscode.l10n.t('How should the extension source loader.uf2 and xous.uf2?'),
		matchOnDescription: true,
		matchOnDetail: true,
	});

	if (!picked) return undefined;

	if (picked.mode === 'manual') {
		const folders = await vscode.window.showOpenDialog({
			title: vscode.l10n.t('Select folder containing loader.uf2 and xous.uf2'),
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: vscode.l10n.t('Use this folder'),
		});
		if (!folders?.length) return undefined;
		await vscode.workspace
			.getConfiguration('')
			.update(KERNEL_FILES_PATH_KEY, folders[0].fsPath, vscode.ConfigurationTarget.Workspace);
	}

	await saveKernelMode(picked.mode);
	vscode.window.showInformationMessage(
		vscode.l10n.t(
			'Kernel mode set to "{0}". You can change this in Settings under Baochip.',
			picked.mode,
		),
	);

	return picked.mode;
}

/**
 * Ensures kernel mode is configured and, for ci-sync mode, fetches and applies
 * the latest xous-core rev to Cargo.toml before building.
 * Returns false if the user cancels or any step fails.
 */
export async function ensureOutOfTreeBuildSetup(root: string): Promise<boolean> {
	const kernelMode = await ensureKernelModeConfigured();
	if (!kernelMode) return false;

	if (kernelMode === 'ci-sync') {
		let rev: string;
		try {
			rev = await fetchLatestXousCoreRev();
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			vscode.window.showErrorMessage(
				vscode.l10n.t('Failed to fetch latest xous-core rev: {0}', message),
			);
			return false;
		}
		try {
			await runBaoCmd(['app', 'update-rev', '--file', path.join(root, 'Cargo.toml'), '--rev', rev]);
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			vscode.window.showErrorMessage(
				vscode.l10n.t('Failed to update xous-core rev in Cargo.toml: {0}', message),
			);
			return false;
		}
	}

	return true;
}
