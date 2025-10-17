import * as vscode from 'vscode';
import { ensureBaoPath } from '@services/pathService';
import { getMonitorPort, getDefaultBaud, getPythonCmd } from '@services/configService';
import { MonitorPanel } from '@webviews/monitor/monitorPanel';
export function registerOpenMonitor(context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand('baochip.openMonitor', async () => {
    const port = getMonitorPort();
    if (!port) { vscode.window.showInformationMessage('No port set. Pick one first.'); await vscode.commands.executeCommand('baochip.setMonitorPort'); return; }
    let baoPath: string;
    try { baoPath = await ensureBaoPath(context); }
    catch (e: any) { vscode.window.showWarningMessage(e?.message || 'bao.py not set'); return; }

    MonitorPanel.show(context, {
      pythonCmd: getPythonCmd(),
      baoPath,
      port,
      baud: getDefaultBaud()
    });
  });
}
