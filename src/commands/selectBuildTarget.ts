import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { promptAndSaveBuildTarget } from '@services/buildService';

export function registerSelectBuildTarget(refreshUI: () => void) {
	return withCommand(Commands.selectBuildTarget, async () => {
		const target = await promptAndSaveBuildTarget();
		if (target) refreshUI();
	});
}
