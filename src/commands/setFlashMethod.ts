import * as vscode from 'vscode';
import {
  getFlashMethod,
  setFlashMethod,
  getFlashMethodsFallback,
} from '@services/configService';

export function registerSetFlashMethod(
  context: vscode.ExtensionContext,
  refreshUI: () => void
) {
  return vscode.commands.registerCommand('baochip.setFlashMethod', async () => {
    const methods = getFlashMethodsFallback();
    if (methods.length === 0) {
      vscode.window.showWarningMessage('No flash methods available.');
      return;
    }

    const current = getFlashMethod();
    const picked = await vscode.window.showQuickPick(
      methods.map(m => ({
        label: m,
        description: m === current ? 'current' : undefined,
      })),
      { placeHolder: 'Select flash method' }
    );
    if (!picked) return;

    await setFlashMethod(picked.label);
    vscode.window.showInformationMessage(`Flash method set to ${picked.label}`);
    refreshUI();
  });
}
