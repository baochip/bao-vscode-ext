import * as vscode from 'vscode';
import { ensureXousCorePath, resolveBaoPy, ensurePythonCmd } from '@services/pathService';
import { ensureBuildPrereqs, runBuildAndWait } from '@services/buildService';
import { decideAndFlash } from '@services/flashService';
import { sendBoot } from '@services/bootService';
import { openMonitorTTYOnMode } from '@services/monitorService';

export function registerBuildFlashMonitor(context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand('baochip.buildFlashMonitor', async () => {
    // Gather/validate build prereqs (root/target/app)
    const pre = await ensureBuildPrereqs();
    if (!pre) return;

    // Also resolve bao.py & python
    let root: string, bao: string, py: string;
    try { root = await ensureXousCorePath(); bao = await resolveBaoPy(); py = await ensurePythonCmd(); }
    catch (e: any) { vscode.window.showErrorMessage(e?.message || 'xous-core / bao.py not set'); return; }

    // 1) Build
    const code = await runBuildAndWait(pre.root, pre.target, pre.app);
    if (code !== 0) { vscode.window.showErrorMessage('Build failed.'); return; }

    // 2) Flash 
    const flashed = await decideAndFlash(py, bao, pre.root);
    if (!flashed) return; 

    const ok = await sendBoot(py, bao, root);
    if (!ok) return;

    // Give the OS a little bit..
    await new Promise(r => setTimeout(r, 2000));

    // 3) Monitor
    await openMonitorTTYOnMode('run');
  });
}
