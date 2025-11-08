import * as vscode from 'vscode';
import { setFlashLocation } from '@services/configService';
import { gateToolsBao } from '@services/versionGate';

export function registerSetFlashLocation(_context: vscode.ExtensionContext, refreshUI: () => void) {
  return gateToolsBao('baochip.setFlashLocation', async () => {
    const selectFolderBtn = vscode.l10n.t('button.selectFolder');
    const ok = await vscode.window.showInformationMessage(
      vscode.l10n.t('flash.selectDriveInstructions'),
      { modal: true },
      selectFolderBtn
    );
    if (ok !== selectFolderBtn) {
      throw new Error(vscode.l10n.t('flash.locationNotSet'));
    }

    const pick = await vscode.window.showOpenDialog({
      title: vscode.l10n.t('flash.selectDriveTitle'),
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: vscode.l10n.t('button.useThisLocation'),
    });

    if (!pick || pick.length === 0) return;
    const folder = pick[0].fsPath;

    await setFlashLocation(folder);
    vscode.window.showInformationMessage(vscode.l10n.t('flash.locationSet', folder));
    refreshUI();
  });
}
