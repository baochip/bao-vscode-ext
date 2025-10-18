import * as vscode from 'vscode';
import * as path from 'path';

export async function openAppFolder(appDir: string) {
  const choice = await vscode.window.showInformationMessage(
    `Open app folder "${path.basename(appDir)}"?`,
    'Open Here',
    'Open in New Window',
    'Just Add to Workspace'
  );
  if (!choice) return;

  const uri = vscode.Uri.file(appDir);

  if (choice === 'Open Here') {
    await vscode.commands.executeCommand('vscode.openFolder', uri, false);
  } else if (choice === 'Open in New Window') {
    await vscode.commands.executeCommand('vscode.openFolder', uri, true);
  } else {
    // Add as an additional workspace folder without closing the current one
    const existing = vscode.workspace.workspaceFolders ?? [];
    vscode.workspace.updateWorkspaceFolders(existing.length, 0, { uri, name: path.basename(appDir) });
  }
}
