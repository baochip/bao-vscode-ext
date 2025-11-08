import * as vscode from 'vscode';
import { getMonitorDefaultPort, setMonitorDefaultPort } from '@services/configService';
import { gateToolsBao } from '@services/versionGate';

export function registerSetMonitorDefaultPort(context: vscode.ExtensionContext, refreshUI: () => void) {
  return gateToolsBao('baochip.setMonitorDefaultPort', async () => {
    const current = getMonitorDefaultPort();
    const runLabel = vscode.l10n.t('monitor.option.run');
    const bootLabel = vscode.l10n.t('monitor.option.bootloader');

    const picked = await vscode.window.showQuickPick(
      [
        { label: runLabel, value: 'run' as const },
        { label: bootLabel, value: 'bootloader' as const }
      ],
      { placeHolder: vscode.l10n.t('pick.currentPlaceholder', current === 'run' ? vscode.l10n.t('label.run') : vscode.l10n.t('label.bootloader')) }
    );
    if (!picked) return;

    setMonitorDefaultPort(picked.value);
    vscode.window.showInformationMessage(vscode.l10n.t('monitor.defaultPortSet', picked.value));
    refreshUI();
  });
}
