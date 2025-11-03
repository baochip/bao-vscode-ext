import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { setXousCorePath } from '@services/configService';

function real(p: string): string {
  try {
    const abs = path.resolve(p);
    const rp = (fs.realpathSync as any).native ? (fs.realpathSync as any).native(abs) : fs.realpathSync(abs);
    return process.platform === 'win32' ? rp.toLowerCase() : rp;
  } catch {
    const abs = path.resolve(p);
    return process.platform === 'win32' ? abs.toLowerCase() : abs;
  }
}

function isSameOrParent(parent: string, child: string): boolean {
  const a = real(parent);
  const b = real(child);
  if (a === b) return true;
  const aSep = a.endsWith(path.sep) ? a : a + path.sep;
  return b.startsWith(aSep);
}

/**
 * Ensure a workspace that *covers* `xousRoot` is open.
 * If a different folder is open, offer:
 *  - Open the configured xous-core
 *  - Update setting to the currently-open workspace
 */
export async function ensureXousWorkspaceOpen(xousRoot: string): Promise<boolean> {
  const want = real(xousRoot);
  const folders = vscode.workspace.workspaceFolders || [];

  // Accept if any folder equals or contains xousRoot, or vice-versa.
  for (const f of folders) {
    const cur = real(f.uri.fsPath);
    if (isSameOrParent(cur, want) || isSameOrParent(want, cur)) {
      // Make sure the setting is saved for this workspace context
      await setXousCorePath(xousRoot);
      return true;
    }
  }

  // At least one folder is open but it's not the configured one.
  if (folders.length > 0) {
    const openPaths = folders.map(f => f.uri.fsPath).join('\n  • ');
    const choice = await vscode.window.showWarningMessage(
      [
        'The currently open workspace does not match your configured xous-core path.',
        '',
        `Configured xous-core: ${xousRoot}`,
        `Open workspace(s):`,
        `  • ${openPaths}`,
        '',
        'Choose what to do:',
      ].join('\n'),
      { modal: true },
      'Open configured xous-core',        // opens xousRoot
      'Use current workspace instead',    // updates setting to the open folder
      'Cancel',
    );

    if (choice === 'Open configured xous-core') {
      // Persist path globally before we reload/open the folder.
      await setXousCorePath(xousRoot, vscode.ConfigurationTarget.Global);
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(xousRoot), false);
      return false; // window will reload
    }

    if (choice === 'Use current workspace instead') {
      // Pick the first folder
      const chosen = folders[0].uri.fsPath;
      await setXousCorePath(chosen);
      return true;
    }

    return false;
  }

  const openChoice = await vscode.window.showInformationMessage(
    `No xous-core workspace is open. Open "${xousRoot}" to continue?`,
    { modal: true },
    'Open',
  );
  if (openChoice !== 'Open') return false;

  await setXousCorePath(xousRoot, vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(xousRoot), false);
  return false; // window reloads
}

export async function revealAppFolder(xousRoot: string, appName: string) {
  await vscode.commands.executeCommand('workbench.view.explorer');
  const appDir = path.join(xousRoot, 'apps-dabao', appName);
  try {
    await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
  } catch {}
  await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(appDir));
}
