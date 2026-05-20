import {
	ensureBuildPrereqs,
	runBuildInTerminal,
	runOutOfTreeBuildInTerminal,
} from '@services/buildService';
import * as vscode from 'vscode';

export function registerBuildCommand(_context: vscode.ExtensionContext) {
	return vscode.commands.registerCommand('baochip.build', async () => {
		const pre = await ensureBuildPrereqs();
		if (!pre) return;
		if (pre.mode === 'out-of-tree') {
			runOutOfTreeBuildInTerminal(pre.root);
		} else {
			runBuildInTerminal(pre.root, pre.target, pre.app);
		}
	});
}
