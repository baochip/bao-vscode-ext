import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const REPO = 'https://github.com/betrusted-io/xous-core';

export async function cloneXousCore(): Promise<string | undefined> {
  // Ask where to put it
  const destUris = await vscode.window.showOpenDialog({
    title: vscode.l10n.t('Choose a folder to clone xous-core into'),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: vscode.l10n.t('Clone here')
  });
  if (!destUris || destUris.length === 0) return;

  const destFsPath = destUris[0].fsPath; // <-- string path, not Uri

  // Try built-in Git clone command
  try {
    await vscode.commands.executeCommand('git.clone', REPO, destFsPath);
  } catch (e) {
    // Fallback: open the repo URL if Git extension/command isn't available
    await vscode.env.openExternal(vscode.Uri.parse(REPO));
    vscode.window.showWarningMessage(vscode.l10n.t('Opening repo in browser. After cloning locally, select the folder in settings.'));
    return;
  }

  // Common case: git creates "<chosen folder>/xous-core"
  const guess = path.join(destFsPath, 'xous-core');
  if (fs.existsSync(guess) && fs.statSync(guess).isDirectory()) {
    return guess;
  }

  // If user renamed the folder during clone, prompt them to pick the cloned folder
  const picked = await vscode.window.showOpenDialog({
    title: vscode.l10n.t('Select your cloned xous-core folder'),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: vscode.l10n.t('Use this folder')
  });
  return picked?.[0]?.fsPath;
}
