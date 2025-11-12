import * as vscode from 'vscode';
import { ensureXousCorePath, resolveBaoPy, runBaoCmd } from '@services/pathService';
import { ensureBuildPrereqs, runBuildAndWait } from '@services/buildService';
import { decideAndFlash } from '@services/flashService';
import { sendBoot } from '@services/bootService';
import { openMonitorTTYOnMode } from '@services/monitorService';
import { waitForPort } from '@services/portsService';
import { getRunSerialPort } from '@services/configService';
import { gateToolsBao } from '@services/versionGate';

export function registerBuildFlashMonitor(context: vscode.ExtensionContext) {
  return gateToolsBao('baochip.buildFlashMonitor', async () => {
    // Gather/validate build prereqs (root/target/app)
    const pre = await ensureBuildPrereqs();
    if (!pre) return;

    // Also resolve bao.py (root)
    let root: string, bao: string;
    try { root = await ensureXousCorePath(); bao = await resolveBaoPy(); }
    catch (e: any) { vscode.window.showErrorMessage(e?.message || 'xous-core / bao.py not set'); return; }

    // 1) Build
    const code = await runBuildAndWait(pre.root, pre.target, pre.app);
    if (code !== 0) { vscode.window.showErrorMessage('Build failed.'); return; }

    // 2) Flash 
    const flashed = await decideAndFlash(pre.root);
    if (!flashed) return; 

    // 2.5) Tell device to exit bootloader and run firmware
    const ok = await sendBoot(runBaoCmd, bao, root);
    if (!ok) return;

    // Ensure run-mode port is set; if not, prompt and re-check.
    let runPort = getRunSerialPort();
    if (!runPort) {
      vscode.window.showInformationMessage('No run mode serial port set. Pick one first.');
      await vscode.commands.executeCommand('baochip.setRunSerialPort');

      // Re-check after the command returns.
      runPort = getRunSerialPort();
      if (!runPort) {
        vscode.window.showWarningMessage('Run mode serial port is still not set. Aborting monitor.');
        return;
      }
    }

    // 3) Monitor (wait for run port to appear)
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Baochip: waiting for ${runPort}…`, cancellable: false },
      async (progress) => {
        // small grace period so the bootloader can drop cleanly
        await new Promise(r => setTimeout(r, 300));

        progress.report({ message: 'waiting for run mode serial port…' });
        const seen = await waitForPort(runBaoCmd, runPort!, { cwd: root, timeoutMs: 20000, intervalMs: 500 });

        if (!seen) {
          vscode.window.showWarningMessage(`Run mode port ${runPort} didn’t appear in time. Trying anyway…`);
        }

        await openMonitorTTYOnMode('run');
      }
    );
  });
}
