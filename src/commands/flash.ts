import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { ensureBuildTarget } from '@services/buildTargetService';
import { decideAndFlash } from '@services/flashService';
import { resolveKernelFiles } from '@services/kernelService';
import { getOutOfTreeRoot, getProjectMode } from '@services/projectModeService';
import { resolveXousRootOrNotify } from '@services/xousCoreService';

export function registerFlashCommand() {
	return withCommand(Commands.flash, async () => {
		if (getProjectMode() === 'out-of-tree') {
			const root = getOutOfTreeRoot();
			if (!root) return;
			// The kernel to flash depends on the board, so ask before resolving one.
			if (!(await ensureBuildTarget())) return;
			const kernelFiles = await resolveKernelFiles();
			if (!kernelFiles) return;
			await decideAndFlash(root, kernelFiles);
			return;
		}

		const root = await resolveXousRootOrNotify();
		if (!root) return;

		if (!(await ensureBuildTarget())) return;

		// No app check: flash pushes the already-built UF2s from disk, so which app is
		// configured is irrelevant here (it only matters at build time).
		await decideAndFlash(root);
	});
}
