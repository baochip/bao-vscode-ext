import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { type BaoArtifact, fetchArtifacts } from '@services/artifactsService';
import { getFlashLocation, setFlashLocation } from '@services/configService';
import { getChannel } from '@services/logService';
import { toMessage } from '@util/error';
import * as vscode from 'vscode';

/** Scan the filesystem for mounted BAOCHIP UF2 drives by volume label. */
function findBaochipDrives(): string[] {
	const platform = os.platform();

	if (platform === 'darwin') {
		try {
			return fs
				.readdirSync('/Volumes')
				.filter((n) => n === 'BAOCHIP' || n.startsWith('BAOCHIP '))
				.map((n) => `/Volumes/${n}`)
				.filter((p) => fs.statSync(p).isDirectory());
		} catch {
			return [];
		}
	}

	if (platform === 'linux') {
		const user = os.userInfo().username;
		const roots = [`/media/${user}`, `/run/media/${user}`];
		const found: string[] = [];
		for (const root of roots) {
			try {
				for (const n of fs.readdirSync(root)) {
					if (n === 'BAOCHIP' || n.startsWith('BAOCHIP ')) {
						const p = `${root}/${n}`;
						if (fs.statSync(p).isDirectory()) found.push(p);
					}
				}
			} catch {
				// root may not exist on this distro
			}
		}
		return found;
	}

	if (platform === 'win32') {
		try {
			const r = spawnSync(
				'powershell',
				[
					'-NoProfile',
					'-Command',
					'Get-Volume -FileSystemLabel BAOCHIP -ErrorAction SilentlyContinue | Select-Object -ExpandProperty DriveLetter',
				],
				{ encoding: 'utf8' },
			);
			if (r.status === 0 && r.stdout) {
				return r.stdout
					.split(/\r?\n/)
					.map((l) => l.trim())
					.filter(Boolean)
					.map((letter) => `${letter}:\\`);
			}
		} catch {
			return [];
		}
	}

	return [];
}

/** If drives are found, auto-select (1 drive) or show a picker (multiple). Returns path or undefined. */
async function pickFromDetectedDrives(): Promise<string | undefined> {
	const found = findBaochipDrives();
	if (found.length === 0) return undefined;
	if (found.length === 1) return found[0];

	const pick = await vscode.window.showQuickPick(
		found.map((p) => ({ label: p })),
		{
			title: vscode.l10n.t('Multiple BAOCHIP drives found — select one to flash'),
			ignoreFocusOut: true,
		},
	);
	return pick?.label;
}

async function pathExists(absPath: string): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
		return true;
	} catch {
		return false;
	}
}

/** Stream-compute the MD5 hex digest of a file. */
function md5File(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('md5');
		const stream = fs.createReadStream(filePath);
		stream.on('error', reject);
		stream.on('data', (chunk) => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

export async function promptForFlashFolder(): Promise<string | undefined> {
	const pick = await vscode.window.showOpenDialog({
		title: vscode.l10n.t('Select mounted baochip drive'),
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: vscode.l10n.t('Use this location'),
	});
	return pick && pick.length > 0 ? pick[0].fsPath : undefined;
}

/** Modal instructing the user to mount the baochip; returns true if they chose to pick a folder. */
export async function confirmBaochipMountedPrompt(): Promise<boolean> {
	const selectFolderLabel = vscode.l10n.t('Select Folder');
	const ok = await vscode.window.showInformationMessage(
		vscode.l10n.t(
			'You need to select the drive where your baochip is mounted.\n\n1) Make sure your baochip is plugged in.\n2) If you cannot see the BAOCHIP drive on your computer, press the RESET button and wait for the drive to appear.',
		),
		{ modal: true },
		selectFolderLabel,
	);
	return ok === selectFolderLabel;
}

// Poll the same path briefly to allow a freshly mounted drive to appear.
async function waitForDrive(absPath: string, timeoutMs = 8000, intervalMs = 500): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (await pathExists(absPath)) return true;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return false;
}

export async function ensureFlashLocation(): Promise<string | undefined> {
	let dest = getFlashLocation();

	// Case 1: not set yet → try auto-detect, then prompt to pick & save
	if (!dest) {
		const detected = await pickFromDetectedDrives();
		if (detected) {
			await setFlashLocation(detected);
			return detected;
		}

		if (!(await confirmBaochipMountedPrompt())) return undefined;

		const picked = await promptForFlashFolder();
		if (!picked) return undefined;

		await setFlashLocation(picked);
		dest = picked;
	}

	// Case 2: set but missing → try auto-detect first, then offer "Select New Location" or "Continue"
	if (!(await pathExists(dest))) {
		const detected = await pickFromDetectedDrives();
		if (detected) {
			await setFlashLocation(detected);
			return detected;
		}

		const selectNewLabel = vscode.l10n.t('Select New Location');
		const continueLabel = vscode.l10n.t('Continue');

		const choice = await vscode.window.showWarningMessage(
			vscode.l10n.t(
				'Device not found at {0}\n\n' +
					'• Is the board in bootloader mode? (press RESET on the board)\n' +
					'• Is the board plugged in?\n\n' +
					'Select "Continue" if the device appears after checking cable and pressing RESET.\n\n' +
					'Otherwise, select a new location for the BAOCHIP device.',
				dest,
			),
			{ modal: true },
			selectNewLabel,
			continueLabel,
		);

		if (choice === selectNewLabel) {
			const picked = await promptForFlashFolder();
			if (!picked) return undefined;
			await setFlashLocation(picked);
			dest = picked;

			if (!(await pathExists(dest))) {
				vscode.window.showErrorMessage(
					vscode.l10n.t('Selected location is not accessible: {0}', dest),
				);
				return undefined;
			}
		} else if (choice === continueLabel) {
			const appeared = await waitForDrive(dest, 8000, 500);
			if (!appeared) {
				vscode.window.showErrorMessage(vscode.l10n.t('Drive did not appear at: {0}', dest));
				return undefined;
			}
		} else {
			return undefined; // user cancelled
		}
	}

	return dest;
}

export async function gatherArtifacts(root: string) {
	const images = await fetchArtifacts(root).catch<BaoArtifact[]>(() => []);
	const byRole: Record<'loader' | 'xous' | 'apps', string | undefined> = {
		loader: images.find((artifact) => artifact.role === 'loader')?.path,
		xous: images.find((artifact) => artifact.role === 'xous')?.path,
		apps: images.find((artifact) => artifact.role === 'apps')?.path,
	};
	const all: string[] = (['loader', 'xous', 'apps'] as const)
		.map((r) => byRole[r])
		.filter((p): p is string => !!p);

	return { byRole, all };
}

function getFlashChannel(): vscode.OutputChannel {
	return getChannel(vscode.l10n.t('Bao Flash'));
}

export async function flashFiles(dest: string, files: string[]): Promise<boolean> {
	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Flashing…'),
			cancellable: true,
		},
		async (_progress, token) => {
			try {
				let copied = 0;
				const chan = getFlashChannel();
				chan.clear();
				chan.show(true);

				for (const srcPath of files) {
					if (token.isCancellationRequested) break;

					const fileName = path.basename(srcPath);
					const srcUri = vscode.Uri.file(srcPath);
					const dstUri = vscode.Uri.file(path.join(dest, fileName));

					// Compute MD5 hash
					const md5 = await md5File(srcUri.fsPath);

					chan.appendLine(`[bao] ${vscode.l10n.t('Flashing {0}', fileName)}`);
					chan.appendLine(`      ${vscode.l10n.t('MD5: {0}', md5)}`);

					await vscode.workspace.fs.copy(srcUri, dstUri, { overwrite: true });
					copied++;
				}

				if (token.isCancellationRequested) {
					vscode.window.showWarningMessage(vscode.l10n.t('Baochip: Flash cancelled.'));
					return false;
				}

				vscode.window.showInformationMessage(
					vscode.l10n.t('Baochip: flashed {0} file(s) to {1}.', copied, dest),
				);
				chan.appendLine(`[bao] ${vscode.l10n.t('Flash complete ({0} file(s))', copied)}`);
				return true;
			} catch (e: unknown) {
				const msg = toMessage(e);
				vscode.window.showErrorMessage(vscode.l10n.t('Baochip flash failed: {0}', msg));
				return false;
			}
		},
	);
}

export async function decideAndFlash(
	root: string,
	kernelFiles?: { loader: string; xous: string },
): Promise<boolean> {
	const dest = await ensureFlashLocation();
	if (!dest) return false;

	let files: string[];

	if (kernelFiles) {
		// Out-of-tree: flash kernel files + apps.uf2 from project root
		const appsUf2 = path.join(root, 'apps.uf2');
		if (!fs.existsSync(appsUf2)) {
			vscode.window.showErrorMessage(
				vscode.l10n.t('apps.uf2 not found in {0}. Run a build first.', root),
			);
			return false;
		}
		files = [kernelFiles.loader, kernelFiles.xous, appsUf2];
	} else {
		// xous-core mode: discover artifacts from the build output
		const { all } = await gatherArtifacts(root);
		if (all.length === 0) {
			vscode.window.showWarningMessage(
				vscode.l10n.t('No UF2s found (loader/xous/apps). Build first, then flash.'),
			);
			return false;
		}
		files = all;
	}

	return flashFiles(dest, files);
}
