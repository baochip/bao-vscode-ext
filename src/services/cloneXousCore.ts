import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const REPO = 'https://github.com/betrusted-io/xous-core';

export async function cloneXousCore(): Promise<string | undefined> {
  // Ask where to put it
  const destUris = await vscode.window.showOpenDialog({
    title: vscode.l10n.t('clone.chooseFolderTitle'),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: vscode.l10n.t('button.cloneHere')
  });
  if (!destUris || destUris.length === 0) return;

  const destFsPath = destUris[0].fsPath; // <-- string path, not Uri

  // Try built-in Git clone command
  try {
    await vscode.commands.executeCommand('git.clone', REPO, destFsPath);
  } catch (e) {
    // Fallback: open the repo URL if Git extension/command isn't available
    await vscode.env.openExternal(vscode.Uri.parse(REPO));
    vscode.window.showWarningMessage(vscode.l10n.t('clone.openRepoFallback'));
    return;
  }

  // Common case: git creates "<chosen folder>/xous-core"
  const guess = path.join(destFsPath, 'xous-core');
  if (fs.existsSync(guess) && fs.statSync(guess).isDirectory()) {
    return guess;
  }

  // If user renamed the folder during clone, prompt them to pick the cloned folder
  const picked = await vscode.window.showOpenDialog({
    title: vscode.l10n.t('clone.selectClonedTitle'),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: vscode.l10n.t('button.useThisFolder')
  });
  return picked?.[0]?.fsPath;
}
