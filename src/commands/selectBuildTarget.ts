import { withCommand } from '@commands/withCommand';
import { promptAndSaveBuildTarget } from '@services/buildService';

export function registerSelectBuildTarget(refreshUI: () => void) {
	return withCommand('baochip.selectBuildTarget', async () => {
		const target = await promptAndSaveBuildTarget();
		if (target) refreshUI();
	});
}
