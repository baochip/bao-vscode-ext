import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { targetForBoardType } from '@constants';
import {
	imagesForTarget,
	projectImagePath,
	scanArtifacts,
	type Uf2Role,
} from '@services/artifactsService';
import { readBoardType } from '@services/boardTypeService';
import {
	getBuildTarget,
	getCheckBoardTypeBeforeFlash,
	getFlashLocation,
	setCheckBoardTypeBeforeFlash,
	setFlashLocation,
} from '@services/configService';
import {
	appendSeparator,
	getBaochipChannel,
	showErrorWithActions,
	showOutputAction,
	warn,
} from '@services/logService';
import { runProcess } from '@services/procService';
import { toMessage } from '@util/error';
import { classifyWriteVerification } from '@util/flashVerify';
import { isDirectory } from '@util/fsUtil';
import { pollUntil } from '@util/poll';
import {
	BAOCHIP_UF2_FAMILY,
	classifyUf2Fit,
	formatBytes,
	parseUf2FirstBlock,
	UF2_BLOCK_BYTES,
} from '@util/uf2Layout';
import * as vscode from 'vscode';

/** Scan the filesystem for mounted BAOCHIP UF2 drives by volume label. */
async function findBaochipDrives(): Promise<string[]> {
	const platform = process.platform;

	if (platform === 'darwin') {
		try {
			return fs
				.readdirSync('/Volumes')
				.filter((n) => n === 'BAOCHIP' || n.startsWith('BAOCHIP '))
				.map((n) => `/Volumes/${n}`)
				.filter((p) => isDirectory(p));
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
						if (isDirectory(p)) found.push(p);
					}
				}
			} catch {
				// root may not exist on this distro
			}
		}
		return found;
	}

	if (platform === 'win32') {
		const r = await runProcess('powershell', [
			'-NoProfile',
			'-Command',
			'Get-Volume -FileSystemLabel BAOCHIP -ErrorAction SilentlyContinue | Select-Object -ExpandProperty DriveLetter',
		]);
		if (!r.error && r.code === 0 && r.stdout) {
			return r.stdout
				.split(/\r?\n/)
				.map((l) => l.trim())
				.filter(Boolean)
				.map((letter) => `${letter}:\\`);
		}
		return [];
	}

	return [];
}

/** If drives are found, auto-select (1 drive) or show a picker (multiple). Returns path or undefined. */
async function pickFromDetectedDrives(): Promise<string | undefined> {
	const found = await findBaochipDrives();
	if (found.length === 0) return undefined;
	if (found.length === 1) return found[0];

	const pick = await vscode.window.showQuickPick(
		found.map((p) => ({ label: p })),
		{
			title: vscode.l10n.t('Multiple BAOCHIP drives found - select one to flash'),
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
	const result = await pollUntil(() => pathExists(absPath), {
		timeoutMs,
		intervalMs,
		maxErrors: 1, // pathExists swallows errors, so the error path is never reached
		now: Date.now,
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
	});
	return result === 'found';
}

export async function ensureFlashLocation(): Promise<string | undefined> {
	let dest = getFlashLocation();

	// Case 1: not set yet -> try auto-detect, then prompt to pick & save
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

	// Case 2: set but missing -> try auto-detect first, then offer "Select New Location" or "Continue"
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
					'- Is the board in bootloader mode? (press RESET on the board)\n' +
					'- Is the board plugged in?\n\n' +
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

/** The images to flash for `target`, in write order; both targets share one release dir. */
export async function gatherArtifacts(root: string, target?: string) {
	const images = scanArtifacts(root);
	const byRole: Record<Uf2Role, string | undefined> = {
		loader: images.find((artifact) => artifact.role === 'loader')?.path,
		xous: images.find((artifact) => artifact.role === 'xous')?.path,
		apps: images.find((artifact) => artifact.role === 'apps')?.path,
		swap: images.find((artifact) => artifact.role === 'swap')?.path,
	};
	const wanted = target ? imagesForTarget(target) : (['loader', 'xous', 'apps', 'swap'] as const);
	const all: string[] = [...wanted].map((r) => byRole[r]).filter((p): p is string => !!p);

	return { byRole, all };
}

/** Warn when a .uf2 overflows the dabao region it targets; records its exact size either way. */
export function checkUf2Size(filePath: string): void {
	if (getBuildTarget() !== 'dabao') return;

	const head = Buffer.alloc(UF2_BLOCK_BYTES);
	let size: number;
	try {
		size = fs.statSync(filePath).size;
		const fd = fs.openSync(filePath, 'r');
		try {
			fs.readSync(fd, head, 0, UF2_BLOCK_BYTES, 0);
		} finally {
			fs.closeSync(fd);
		}
	} catch {
		return;
	}

	const header = parseUf2FirstBlock(head);
	if (!header || header.familyId !== BAOCHIP_UF2_FAMILY) return;

	const fit = classifyUf2Fit(header.targetAddr, size);
	if (fit.kind === 'unknown') return;

	const fileName = path.basename(filePath);
	getBaochipChannel().appendLine(`[bao] ${fileName}: ${size} bytes (limit ${fit.limit} bytes)`);
	if (fit.kind === 'over') {
		warn(
			vscode.l10n.t(
				'Baochip: {0} is {1} over the {2} limit for dabao. It will not run on the device.',
				fileName,
				formatBytes(fit.over),
				formatBytes(fit.limit),
			),
		);
	}
}

export async function flashFiles(dest: string, files: string[]): Promise<boolean> {
	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Flashing...'),
			cancellable: true,
		},
		async (_progress, token) => {
			try {
				let copied = 0;
				const chan = getBaochipChannel();

				// Size-check every image up front so any warning lands before the device is written to.
				for (const srcPath of files) checkUf2Size(srcPath);

				for (const srcPath of files) {
					if (token.isCancellationRequested) break;

					const fileName = path.basename(srcPath);
					const srcUri = vscode.Uri.file(srcPath);
					const dstUri = vscode.Uri.file(path.join(dest, fileName));

					// Compute source MD5 + size up front, for post-copy verification.
					const srcMd5 = await md5File(srcUri.fsPath);
					const srcSize = (await vscode.workspace.fs.stat(srcUri)).size;

					chan.appendLine(`[bao] ${vscode.l10n.t('Flashing {0}', fileName)}`);
					chan.appendLine(`      ${vscode.l10n.t('MD5: {0}', srcMd5)}`);

					await vscode.workspace.fs.copy(srcUri, dstUri, { overwrite: true });

					// Read back what we can from the destination (some UF2 drives don't return the
					// written bytes on read), then let the classifier decide hash vs size vs failure.
					let dstMd5: string | undefined;
					try {
						dstMd5 = await md5File(dstUri.fsPath);
					} catch {
						dstMd5 = undefined;
					}
					let dstSize: number | undefined;
					try {
						dstSize = (await vscode.workspace.fs.stat(dstUri)).size;
					} catch {
						dstSize = undefined;
					}

					const verdict = classifyWriteVerification(srcMd5, dstMd5, srcSize, dstSize);
					if (!verdict.ok) {
						if (verdict.reason === 'unreadable') {
							throw new Error(
								vscode.l10n.t(
									'Could not verify {0}: destination is unreadable after writing.',
									fileName,
								),
							);
						}
						throw new Error(
							vscode.l10n.t(
								'Verification failed for {0}: wrote {1} of {2} bytes.',
								fileName,
								verdict.wrote,
								verdict.expected,
							),
						);
					}
					chan.appendLine(
						verdict.by === 'md5'
							? `      ${vscode.l10n.t('Verified (MD5 match)')}`
							: `      ${vscode.l10n.t('Verified ({0} bytes)', srcSize)}`,
					);

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
				getBaochipChannel().appendLine(`[bao] ${vscode.l10n.t('Flash failed: {0}', msg)}`);
				// The channel line above already records the failure; the toast just adds the button.
				showErrorWithActions(vscode.l10n.t('Baochip flash failed: {0}', msg), [showOutputAction()]);
				return false;
			}
		},
	);
}

/**
 * Ask the attached board what it is and confirm before flashing images built for another one.
 * Best-effort by design: anything that cannot be compared - no answer, an oem board, a board type
 * this version does not know - goes ahead silently rather than standing between you and a flash.
 */
async function confirmBoardTypeMatches(dest: string): Promise<boolean> {
	const chan = getBaochipChannel();
	if (!getCheckBoardTypeBeforeFlash()) {
		chan.appendLine('[bao] board type check skipped (baochip.checkBoardTypeBeforeFlash is off)');
		return true;
	}

	const target = getBuildTarget();
	if (!target) return true;

	const reading = await readBoardType();
	if (!reading) return true;

	chan.appendLine(
		`[bao] board type: ${reading.type} on ${reading.port} (hardware target: ${target})`,
	);

	const boardTarget = targetForBoardType(reading.type);
	if (!boardTarget || boardTarget === target) return true;

	chan.appendLine(
		`[bao] board reports ${reading.type} on ${reading.port}, hardware target is ${target}`,
	);

	const flashAnyway = { title: vscode.l10n.t('Flash anyway') };
	const stopAsking = { title: vscode.l10n.t('Flash and stop asking') };
	const cancel = { title: vscode.l10n.t('Cancel'), isCloseAffordance: true };
	const picked = await vscode.window.showWarningMessage(
		vscode.l10n.t(
			'The board at {0} is type {1}, but the hardware target is {2}. Are you sure you want to continue flashing?',
			dest,
			reading.type,
			target,
		),
		{ modal: true, detail: vscode.l10n.t('Board type read from {0}.', reading.port) },
		flashAnyway,
		stopAsking,
		cancel,
	);

	if (picked === stopAsking) {
		await setCheckBoardTypeBeforeFlash(false);
		return true;
	}
	return picked === flashAnyway;
}

/** What to flash: an in-tree build's artifacts, or an out-of-tree project image with an
 * optional kernel alongside it. */
export type FlashPlan =
	| { mode: 'xous-core' }
	| { mode: 'out-of-tree'; kernelFiles?: { loader: string; xous: string } };

export async function decideAndFlash(
	root: string,
	plan: FlashPlan = { mode: 'xous-core' },
): Promise<boolean> {
	// Open the section before anything else in the flash step logs into it: the board type
	// check and its uv lines belong under this header, not trailing the previous operation.
	const chan = getBaochipChannel();
	appendSeparator(chan, 'Flash');
	chan.show(true);

	const dest = await ensureFlashLocation();
	if (!dest) return false;

	if (!(await confirmBoardTypeMatches(dest))) return false;

	let files: string[];

	if (plan.mode === 'out-of-tree') {
		// The project image is what this build produced; the kernel comes with it unless the
		// board already has one.
		const image = projectImagePath('out-of-tree', root, getBuildTarget());
		if (!fs.existsSync(image)) {
			vscode.window.showErrorMessage(
				vscode.l10n.t('{0} not found in {1}. Run a build first.', path.basename(image), root),
			);
			return false;
		}
		files = plan.kernelFiles ? [plan.kernelFiles.loader, plan.kernelFiles.xous, image] : [image];
	} else {
		// xous-core mode: discover artifacts from the build output
		const { all } = await gatherArtifacts(root, getBuildTarget());
		if (all.length === 0) {
			vscode.window.showWarningMessage(
				vscode.l10n.t('No valid UF2s found for this hardware target. Build first, then flash.'),
			);
			return false;
		}
		files = all;
	}

	return flashFiles(dest, files);
}
