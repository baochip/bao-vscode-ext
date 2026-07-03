import { withCommand } from '@commands/withCommand';
import {
	ensureBuildPrereqs,
	runBuildInTerminal,
	runOutOfTreeBuildInTerminal,
} from '@services/buildService';
import { ensureOutOfTreeBuildSetup } from '@services/kernelService';
import * as vscode from 'vscode';

export function registerBuildCommand(_context: vscode.ExtensionContext) {
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
