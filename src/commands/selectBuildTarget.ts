import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { promptAndSaveBuildTarget } from '@services/buildTargetService';

export function registerSelectBuildTarget() {
	return withCommand(Commands.selectBuildTarget, async () => {
		await promptAndSaveBuildTarget();
	});
}
