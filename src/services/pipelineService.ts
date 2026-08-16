import { sendBoot } from '@services/bootService';
import {
	ensureBuildPrereqs,
	runBuildAndWait,
	runOutOfTreeBuildAndWait,
} from '@services/buildService';
import { decideAndFlash } from '@services/flashService';
import { ensureOutOfTreeBuildSetup, resolveKernelFiles } from '@services/kernelService';
import { errorToast } from '@services/logService';
import { convertElfToUf2 } from '@services/uf2ConvertService';
import * as vscode from 'vscode';

/** Time the device gets to commit the written images before boot is sent. */
const FLASH_SETTLE_MS = 500;

/**
 * Build the project, flash it to the device, and tell the device to run the new firmware.
 *
 * Returns false when any stage fails or the user cancels; each stage surfaces its own
 * notification, so callers stop quietly on false.
 */
export async function runBuildFlashBoot(): Promise<boolean> {
	// Gather/validate build prereqs (root/target/app)
	const pre = await ensureBuildPrereqs();
	if (!pre) return false;

	if (pre.mode === 'out-of-tree') {
		const ok = await ensureOutOfTreeBuildSetup(pre.root, pre.crates);
		if (!ok) return false;
	}

	// 1) Build
	const code =
		pre.mode === 'out-of-tree'
			? await runOutOfTreeBuildAndWait(pre.root, pre.crates)
			: await runBuildAndWait(pre.root, pre.target, pre.app);
	if (code === null) return false; // cancelled by the user - not a failure, no error toast
	if (code !== 0) {
		// The cargo output for this pipeline streams to the Baochip channel (runCargoAndWait),
		// so the toast's Show Output button lands on the compiler errors.
		errorToast(vscode.l10n.t('Build failed.'));
		return false;
	}

	// 1.5) ELF->UF2 conversion (out-of-tree only)
	if (pre.mode === 'out-of-tree') {
		const converted = await convertElfToUf2(pre.root, pre.crates);
		if (!converted) return false;
	}

	// Resolve kernel files for flashing (out-of-tree only)
	let kernelFiles: { loader: string; xous: string } | null = null;
	if (pre.mode === 'out-of-tree') {
		kernelFiles = await resolveKernelFiles();
		if (!kernelFiles) return false;
	}

	// 2) Flash
	const flashed = await decideAndFlash(pre.root, kernelFiles ?? undefined);
	if (!flashed) return false;

	// A copy that reached the drive is not an image the device has finished committing, and a
	// boot sent into that window is ignored.
	await new Promise((r) => setTimeout(r, FLASH_SETTLE_MS));

	// 2.5) Tell device to exit bootloader and run firmware
	return await sendBoot();
}
