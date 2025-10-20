import * as vscode from 'vscode';
import { ensureXousCorePath, resolveBaoPy, getPythonCmd } from '@services/pathService';
import { ensureBuildPrereqs, runBuildAndWait } from '@services/buildService';
import { decideAndFlash } from '@services/flashService';
import { openMonitor } from '@services/monitorService';

export function registerBuildFlashMonitor(context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand('baochip.buildFlashMonitor', async () => {
    // Gather/validate build prereqs (root/target/app)
    const pre = await ensureBuildPrereqs();
    if (!pre) return;

    // Also resolve bao.py & python
    let bao: string, py: string;
    try { await ensureXousCorePath(); bao = await resolveBaoPy(); py = getPythonCmd(); }
    catch (e: any) { vscode.window.showErrorMessage(e?.message || 'xous-core / bao.py not set'); return; }

    // 1) Build
    const code = await runBuildAndWait(pre.root, pre.target, pre.app);
    if (code !== 0) { vscode.window.showErrorMessage('Build failed.'); return; }

    // 2) Flash (decide all vs app-only)
    const flashed = await decideAndFlash(py, bao, pre.root);
    if (!flashed) return; 

    // 3) Monitor
    await openMonitor(context);
  });
}
