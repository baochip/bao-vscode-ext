import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { setBaoPath, getBaoPath, updateTarget } from './configService';

export function resolveBaoPath(p: string): string {
  if (!p) return p;
  if (path.isAbsolute(p)) return p;
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) return p;
  const candidate = path.join(ws, p);
  return fs.existsSync(candidate) ? candidate : p;
}

export async function ensureBaoPath(context: vscode.ExtensionContext): Promise<string> {
  let p = resolveBaoPath(getBaoPath());
  if (p && fs.existsSync(p)) return p;

  const choice = await vscode.window.showInformationMessage(
    'Baochip needs the path to your CLI script (bao.py).',
    { modal: true, detail: 'Select the bao.py file from your bao-devkit checkout.' },
    'Choose bao.py…', 'Cancel'
  );
  if (choice !== 'Choose bao.py…') throw new Error('bao.py not set');

  const picked = await vscode.window.showOpenDialog({
    title: 'Select bao.py',
    canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
    openLabel: 'Use this bao.py', filters: { Python: ['py'] }
  });
  if (!picked || picked.length === 0) throw new Error('bao.py not set');

  await setBaoPath(picked[0].fsPath);
  return picked[0].fsPath;
}
