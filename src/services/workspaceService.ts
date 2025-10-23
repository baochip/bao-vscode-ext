import * as vscode from 'vscode';
import * as path from 'path';
import { setXousCorePath } from '@services/configService';

export async function ensureXousWorkspaceOpen(xousRoot: string): Promise<boolean> {
  const folders = vscode.workspace.workspaceFolders;
  const currentRoot = folders?.[0]?.uri.fsPath;

  if (currentRoot && samePath(currentRoot, xousRoot)) {
    // Already on xous-core; make sure the setting is saved (in case it wasn't yet)
    await setXousCorePath(xousRoot); // workspace-scoped now that we have one
    return true;
  }

  const choice = await vscode.window.showInformationMessage(
    'No xous-core workspace is open. Open xous-core to continue?',
    { modal: true },
    'Open'
  );
  if (choice !== 'Open') return false;

  // Persist the path *before* we reload/open the folder so future lookups won't prompt.
  await setXousCorePath(xousRoot, vscode.ConfigurationTarget.Global);

  const uri = vscode.Uri.file(xousRoot);
  await vscode.commands.executeCommand('vscode.openFolder', uri, false);
  // Window reloads; nothing after this line will run in this session.
  return false;
}

export async function revealAppFolder(xousRoot: string, appName: string) {
  await vscode.commands.executeCommand('workbench.view.explorer');
  const appDir = path.join(xousRoot, 'apps-bao', appName);
  await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
  await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(appDir));
}

function samePath(a: string, b: string): boolean {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}
