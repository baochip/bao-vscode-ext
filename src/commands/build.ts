import { withCommand } from '@commands/withCommand';
import {
	ensureBuildPrereqs,
	runBuildInTerminal,
	runOutOfTreeBuildInTerminal,
} from '@services/buildService';
import { ensureOutOfTreeBuildSetup } from '@services/kernelService';

export function registerBuildCommand() {
	return withCommand('baochip.build', async () => {
		const pre = await ensureBuildPrereqs();
		if (!pre) return;
		if (pre.mode === 'out-of-tree') {
			const ok = await ensureOutOfTreeBuildSetup(pre.root);
			if (!ok) return;
			runOutOfTreeBuildInTerminal(pre.root);
		} else {
			runBuildInTerminal(pre.root, pre.target, pre.app);
		}
	});
}
