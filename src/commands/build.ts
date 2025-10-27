import * as vscode from 'vscode';
import { ensureBuildPrereqs, runBuildInTerminal } from '@services/buildService';

export function registerBuildCommand(_context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand('baochip.build', async () => {
    const pre = await ensureBuildPrereqs();
    if (!pre) return;
    runBuildInTerminal(pre.root, pre.target, pre.app);
  });
}
