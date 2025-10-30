import * as vscode from 'vscode';
import { getMonitorDefaultPort, setMonitorDefaultPort } from '@services/configService';

export function registerSetMonitorDefaultPort(context: vscode.ExtensionContext, refreshUI: () => void) {
  return vscode.commands.registerCommand('baochip.setMonitorDefaultPort', async () => {
    const current = getMonitorDefaultPort();
    const picked = await vscode.window.showQuickPick(
      [
        { label: 'Run (normal firmware logs)', value: 'run' as const },
        { label: 'Bootloader (drive mode)', value: 'bootloader' as const }
      ],
      { placeHolder: `Current: ${current === 'run' ? 'Run' : 'Bootloader'}` }
    );
    if (!picked) return;
    setMonitorDefaultPort(picked.value);
    vscode.window.showInformationMessage(`Default monitor port set to: ${picked.value}`);
    refreshUI();
  });
}
