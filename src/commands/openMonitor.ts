import * as vscode from 'vscode';
import { resolveBaoPy, ensureXousCorePath, getPythonCmd } from '@services/pathService';
import { getMonitorPort, getDefaultBaud } from '@services/configService';
import { MonitorPanel } from '@webviews/monitor/monitorPanel';

export function registerOpenMonitor(context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand('baochip.openMonitor', async () => {
    const port = getMonitorPort();
    if (!port) {
      vscode.window.showInformationMessage('No port set. Pick one first.');
      await vscode.commands.executeCommand('baochip.setMonitorPort');
      return;
    }

    let baoPath: string;
    let cwd: string;
    try {
      baoPath = await resolveBaoPy();        // <— tools-bao/bao.py inside xous-core
      cwd = await ensureXousCorePath();      // <— xous-core repo root (optional but recommended)
    } catch (e: any) {
      vscode.window.showWarningMessage(e?.message || 'xous-core path not set');
      return;
    }

    MonitorPanel.show(context, {
      pythonCmd: getPythonCmd(),
      baoPath,
      port,
      baud: getDefaultBaud(),
      cwd,                                   // <— pass through
    });
  });
}
