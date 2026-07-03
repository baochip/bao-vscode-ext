import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { promptAndSaveApp } from '@services/appService';
import { ensureBuildTargetOrPrompt } from '@services/buildService';
import { getXousAppName } from '@services/configService';
import { decideAndFlash } from '@services/flashService';
import { resolveKernelFiles } from '@services/kernelService';
import { getOutOfTreeRoot, getProjectMode } from '@services/projectModeService';
import { resolveXousRootOrNotify } from '@services/xousCoreService';

export function registerFlashCommand() {
	return withCommand(Commands.flash, async () => {
		if (getProjectMode() === 'out-of-tree') {
			const root = getOutOfTreeRoot();
			if (!root) return;
			const kernelFiles = await resolveKernelFiles();
			if (!kernelFiles) return;
			await decideAndFlash(root, kernelFiles);
			return;
		}

		const root = await resolveXousRootOrNotify();
		if (!root) return;

		const target = await ensureBuildTargetOrPrompt();
		if (!target) return;

		// No app set yet: prompt to pick one, then continue the flash in the same run.
		if (!getXousAppName()) {
			const picked = await promptAndSaveApp();
			if (!picked) return;
		}

		await decideAndFlash(root);
	});
}
