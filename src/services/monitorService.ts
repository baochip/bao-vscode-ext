import * as vscode from 'vscode';
import { MonitorPanel } from '@webviews/monitor/monitorPanel';
import { getMonitorPort, getDefaultBaud, getPythonCmd } from '@services/configService';
import { ensureXousCorePath, resolveBaoPy } from '@services/pathService';

export async function openMonitor(context: vscode.ExtensionContext) {
  const port = getMonitorPort();
  if (!port) {
    vscode.window.showInformationMessage('No port set. Pick one first.');
    await vscode.commands.executeCommand('baochip.setMonitorPort');
    return;
  }
  let root: string, bao: string;
  try { root = await ensureXousCorePath(); bao = await resolveBaoPy(); }
  catch (e: any) { vscode.window.showWarningMessage(e?.message || 'xous-core / bao.py not set'); return; }

  MonitorPanel.show(context, {
    pythonCmd: getPythonCmd(),
    baoPath: bao,
    port,
    baud: getDefaultBaud(),
    cwd: root,
  });
}
