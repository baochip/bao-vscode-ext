import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { runBuildFlashBoot } from '@services/pipelineService';

export function registerBuildFlashBoot() {
	return withCommand(Commands.buildFlashBoot, async () => {
		// Build, flash, and hand control to the new firmware; no monitor is opened, so the run
		// mode serial port is never needed here.
		await runBuildFlashBoot();
	});
}
