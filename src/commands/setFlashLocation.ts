import * as vscode from 'vscode';
import { setFlashLocation } from '@services/configService';
import { gateToolsBao } from '@services/versionGate';

export function registerSetFlashLocation(_context: vscode.ExtensionContext, refreshUI: () => void) {
  return gateToolsBao('baochip.setFlashLocation', async () => {
      const ok = await vscode.window.showInformationMessage(
        'You need to select the drive where your baochip is mounted.\n\n1) Make sure your baochip is plugged in.\n2) If you cannot see the BAOCHIP drive on your computer, press the RESET button and wait for the drive to appear.',
        { modal: true },
        'Select Folder'
      );
      if (ok !== 'Select Folder') {
        throw new Error('baochip location not set');
      }

    const pick = await vscode.window.showOpenDialog({
      title: 'Select mounted baochip drive',
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Use this location',
    });

    if (!pick || pick.length === 0) return;
    const folder = pick[0].fsPath;

    await setFlashLocation(folder);
    vscode.window.showInformationMessage(`Baochip location set to: ${folder}`);
    refreshUI();
  });
}