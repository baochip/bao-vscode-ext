import * as vscode from 'vscode';

export function registerOpenSettings(context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand('baochip.openSettings', async () => {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'Baochip');
  });
}
