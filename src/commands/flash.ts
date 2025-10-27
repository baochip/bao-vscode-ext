import * as vscode from 'vscode';
import { ensureXousCorePath, resolveBaoPy, ensurePythonCmd } from '@services/pathService';
import { getBuildTarget, getXousAppName } from '@services/configService';
import { decideAndFlash } from '@services/flashService';

export function registerFlashCommand(context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand('baochip.flash', async () => {
    let root: string, bao: string, py: string;
    try { root = await ensureXousCorePath(); bao = await resolveBaoPy(); py = await ensurePythonCmd(); }
    catch (e: any) { vscode.window.showErrorMessage(e?.message || 'xous-core / bao.py not set'); return; }

    const target = getBuildTarget();
    if (!target) { const a = await vscode.window.showWarningMessage('No build target set.', 'Select Target'); if (a==='Select Target') await vscode.commands.executeCommand('baochip.selectBuildTarget'); return; }
    const app = getXousAppName();
    if (!app) { await vscode.window.showWarningMessage('No app selected.'); await vscode.commands.executeCommand('baochip.selectApp'); return; }

    await decideAndFlash(py, bao, root);
  });
}
