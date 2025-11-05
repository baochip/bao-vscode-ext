import * as vscode from 'vscode';
import { ensureBuildPrereqs, runBuildInTerminal } from '@services/buildService';
import { gateToolsBao } from '@services/versionGate';

export function registerBuildCommand(_context: vscode.ExtensionContext) {
  return gateToolsBao('baochip.build', async () => {
    const pre = await ensureBuildPrereqs();
    if (!pre) return;
    runBuildInTerminal(pre.root, pre.target, pre.app);
  });
}
