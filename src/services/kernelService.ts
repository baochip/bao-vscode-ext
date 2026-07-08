import * as fs from 'node:fs';
import * as path from 'node:path';
import { runBaoCmd } from '@services/baoRunnerService';
import {
	getBuildTargetOrDefault,
	getKernelFilesPath,
	getKernelMode,
	type KernelMode,
	setKernelFilesPath,
	setKernelMode,
} from '@services/configService';
import { downloadFile, fetchETag, fetchJson } from '@services/httpService';
import { errorToast } from '@services/logService';
import { getGlobalVenvRoot } from '@services/uvService';
import { toMessage } from '@util/error';
import * as vscode from 'vscode';

const GITHUB_API_COMMITS = 'https://api.github.com/repos/betrusted-io/xous-core/commits/dev';
// Exported for the real-world drift tests, which probe the endpoint for liveness.
export const CI_BASE = 'https://ci.betrusted.io/latest-ci/baochip/dabao';

/**
 * Fetches the latest xous-core commit hash from the GitHub API.
 * Throws on network error or unexpected response.
 */
export async function fetchLatestXousCoreRev(): Promise<string> {
	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Fetching latest xous-core rev...'),
			cancellable: false,
		},
		async () => {
			const data = (await fetchJson(GITHUB_API_COMMITS)) as Record<string, unknown>;
			const sha = data?.sha;
			// Shape-validate: the value gets spliced into Cargo.toml via String.replace, where a
			// crafted response could smuggle $-replacement patterns or TOML syntax.
			if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(sha)) {
				throw new Error(vscode.l10n.t('Unexpected response from GitHub API.'));
			}
			return sha;
		},
	);
}

/** Surface a failed xous-core rev fetch as an error toast (shared by the scaffold and ci-sync setup). */
export function toastRevFetchFailed(e: unknown): void {
	errorToast(vscode.l10n.t('Failed to fetch latest xous-core rev: {0}', toMessage(e)));
}

const KERNEL_ETAG_FILE = 'etags.json';

function readStoredEtags(cacheDir: string): { loader?: string; xous?: string } {
	try {
		const f = path.join(cacheDir, KERNEL_ETAG_FILE);
		if (fs.existsSync(f))
			return JSON.parse(fs.readFileSync(f, 'utf8')) as { loader?: string; xous?: string };
	} catch {}
	return {};
}

function writeStoredEtags(cacheDir: string, etags: { loader?: string; xous?: string }): void {
	try {
		fs.writeFileSync(path.join(cacheDir, KERNEL_ETAG_FILE), JSON.stringify(etags), 'utf8');
	} catch {}
}

function clearStoredEtags(cacheDir: string): void {
	// force:true ignores a missing file, but a real removal failure (e.g. the file locked by
	// another window) is NOT swallowed: it propagates so downloadKernelFiles aborts before writing
	// anything, keeping the on-disk pair coherent rather than leaving new files + stale etags that
	// an offline flash would later trust.
	fs.rmSync(path.join(cacheDir, KERNEL_ETAG_FILE), { force: true });
}

async function fetchKernelEtags(): Promise<{ loader: string | null; xous: string | null }> {
	const [loader, xous] = await Promise.all([
		fetchETag(`${CI_BASE}/loader.uf2`),
		fetchETag(`${CI_BASE}/xous.uf2`),
	]);
	return { loader, xous };
}

async function kernelFilesUpToDate(cacheDir: string): Promise<boolean> {
	// No etags file at all means the last download did not complete (it is invalidated up front and
	// only rewritten on success), so the on-disk pair may be incoherent - do not trust it.
	if (!fs.existsSync(path.join(cacheDir, KERNEL_ETAG_FILE))) return false;

	const { loader: curLoader, xous: curXous } = await fetchKernelEtags();
	// Current etags are unavailable (CI serves none, or we are offline): a completed cache cannot be
	// validated, so trust it rather than re-downloading every online flash or hard-failing offline.
	if (!curLoader || !curXous) return true;

	const stored = readStoredEtags(cacheDir);
	// Completed download, but nothing stored to compare (CI omitted etags then, serves them now):
	// refresh so the cache gets an etag-stamped pair.
	if (!stored.loader || !stored.xous) return false;
	return curLoader === stored.loader && curXous === stored.xous;
}

async function downloadKernelFiles(cacheDir: string): Promise<void> {
	fs.mkdirSync(cacheDir, { recursive: true });
	// Invalidate the stored etags before touching any file: if a download fails partway, the
	// on-disk pair is left incoherent (one new file, one old). With no etags surviving, that
	// mixed pair can never be trusted as up to date later - offline, kernelFilesUpToDate would
	// otherwise return true and flash it. A fresh, complete download rewrites them below.
	clearStoredEtags(cacheDir);
	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Downloading kernel files...'),
			cancellable: false,
		},
		async () => {
			// Store the ETag returned by each GET (the etag of the exact bytes just written), not a
			// separate HEAD afterwards - a HEAD could observe a newer CI publish and stamp the
			// downloaded pair with etags that do not match its bytes, freezing a stale cache.
			const loader = await downloadFile(`${CI_BASE}/loader.uf2`, path.join(cacheDir, 'loader.uf2'));
			const xous = await downloadFile(`${CI_BASE}/xous.uf2`, path.join(cacheDir, 'xous.uf2'));
			writeStoredEtags(cacheDir, { loader: loader ?? undefined, xous: xous ?? undefined });
		},
	);
}

/**
 * Resolves the paths to loader.uf2 and xous.uf2 for out-of-tree flashing.
 * Prompts for the kernel mode first if it is not configured yet (null on cancel).
 * Downloads from CI if needed (ci-sync), or reads from the user's folder (manual).
 * Returns null on failure.
 */
export async function resolveKernelFiles(): Promise<{ loader: string; xous: string } | null> {
	// A fresh user can hit Flash before ever building, so the one-time mode prompt must
	// happen here too, not only on the build path.
	const mode = await ensureKernelModeConfigured();
	if (!mode) return null;

	if (mode === 'manual') {
		const folder = getKernelFilesPath();
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

	// ci-sync: use cached files, downloading if not yet present.
	// CI_BASE is dabao-only. A baosec CI path exists upstream, but which UF2 artifacts it
	// carries is not yet known - so any other target must fail clearly here rather than
	// silently flash dabao kernels onto a different board.
	const target = getBuildTargetOrDefault();
	if (target !== 'dabao') {
		vscode.window.showErrorMessage(
			vscode.l10n.t(
				'CI kernel sync is only available for the dabao target. Use manual kernel mode for "{0}".',
				target,
			),
		);
		return null;
	}
	const cacheDir = path.join(getGlobalVenvRoot(), 'kernel');
	const loader = path.join(cacheDir, 'loader.uf2');
	const xous = path.join(cacheDir, 'xous.uf2');

	const needsDownload =
		!fs.existsSync(loader) || !fs.existsSync(xous) || !(await kernelFilesUpToDate(cacheDir));
	if (needsDownload) {
		try {
			await downloadKernelFiles(cacheDir);
		} catch (e: unknown) {
			const message = toMessage(e);
			errorToast(vscode.l10n.t('Baochip: Failed to download kernel files.\n{0}', message));
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
	const saved = getKernelMode();
	if (saved !== 'ask') return saved;

	const syncLabel = vscode.l10n.t('Sync to latest');
	const manualLabel = vscode.l10n.t('Manage my own files');

	const result = await vscode.window.showInformationMessage(
		vscode.l10n.t('Set Up Kernel Files for Out-of-Tree Build'),
		{
			modal: true,
			detail: vscode.l10n.t(
				'- SYNC TO LATEST  (ci-sync)\n      Updates your Cargo.toml rev to the latest xous-core commit.\n      Downloads matching loader.uf2 + xous.uf2 from CI.\n      App and kernel are usually from the same commit (the CI kernel can lag briefly).\n\n- MANAGE MY OWN FILES  (manual)\n      Uses loader.uf2 + xous.uf2 from a folder you specify.\n      Does not change your Cargo.toml rev.',
			),
		},
		syncLabel,
		manualLabel,
	);

	if (!result) return undefined;

	const modeMap: Record<string, KernelMode> = {
		[syncLabel]: 'ci-sync',
		[manualLabel]: 'manual',
	};
	const resolvedMode = modeMap[result];
	if (!resolvedMode) return undefined;

	if (resolvedMode === 'manual') {
		const folders = await vscode.window.showOpenDialog({
			title: vscode.l10n.t('Select folder containing loader.uf2 and xous.uf2'),
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: vscode.l10n.t('Use this folder'),
		});
		if (!folders?.length) return undefined;
		await setKernelFilesPath(folders[0].fsPath);
	}

	await setKernelMode(resolvedMode);
	vscode.window.showInformationMessage(
		vscode.l10n.t(
			'Kernel mode set to "{0}". You can change this in Settings under Baochip.',
			resolvedMode,
		),
	);

	return resolvedMode;
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
			toastRevFetchFailed(e);
			return false;
		}
		try {
			// quiet: this caller shows its own specific error toast below; without it runBaoCmd
			// would also toast on failure, giving two toasts for one failed update-rev.
			await runBaoCmd(
				['app', 'update-rev', '--file', path.join(root, 'Cargo.toml'), '--rev', rev],
				undefined,
				{ quiet: true },
			);
		} catch (e: unknown) {
			const message = toMessage(e);
			errorToast(vscode.l10n.t('Failed to update xous-core rev in Cargo.toml: {0}', message));
			return false;
		}
	}

	return true;
}
