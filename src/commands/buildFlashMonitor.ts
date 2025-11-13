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
    catch (e: any) { vscode.window.showErrorMessage(e?.message || vscode.l10n.t('prereq.xousOrBaoNotSet')); return; }

    // 1) Build
    const code = await runBuildAndWait(pre.root, pre.target, pre.app);
    if (code !== 0) { vscode.window.showErrorMessage(vscode.l10n.t('build.failed')); return; }

    // 2) Flash 
    const flashed = await decideAndFlash(pre.root);
    if (!flashed) return; 

    // 2.5) Tell device to exit bootloader and run firmware
    const ok = await sendBoot(runBaoCmd, bao, root);
    if (!ok) return;

    // Ensure run-mode port is set; if not, prompt and re-check.
    let runPort = getRunSerialPort();
    if (!runPort) {
      vscode.window.showInformationMessage(vscode.l10n.t('ports.noRunPortSet'));
      await vscode.commands.executeCommand('baochip.setRunSerialPort');

      // Re-check after the command returns.
      runPort = getRunSerialPort();
      if (!runPort) {
        vscode.window.showWarningMessage(vscode.l10n.t('ports.runPortStillUnsetAbort'));
        return;
      }
    }

    // 3) Monitor (wait for run port to appear)
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('monitor.waitingForPort.title', runPort), cancellable: false },
      async (progress) => {
        // small grace period so the bootloader can drop cleanly
        await new Promise(r => setTimeout(r, 300));

        progress.report({ message: vscode.l10n.t('ports.waitingRunPort') });
        const seen = await waitForPort(runBaoCmd, runPort!, { cwd: root, timeoutMs: 20000, intervalMs: 500 });

        if (!seen) {
          vscode.window.showWarningMessage(vscode.l10n.t('ports.runPortTimeoutTryAnyway', runPort));
        }

        await openMonitorTTYOnMode('run');
      }
    );
  });
}
