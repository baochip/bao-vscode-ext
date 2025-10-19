import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { setXousCorePath } from '@services/configService'; 

const cfg = () => vscode.workspace.getConfiguration();

export function getPythonCmd(): string {
  return cfg().get<string>('baochip.pythonCommand') || 'python';
}

export async function ensureXousCorePath(): Promise<string> {
  let p = cfg().get<string>('baochip.xousCorePath') || '';
  if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;

  const ok = await vscode.window.showInformationMessage(
    'You need to select your local xous-core folder to run tools-bao/bao.py and cargo xtask builds.',
    { modal: true },
    'Select Folder'
  );
  if (ok !== 'Select Folder') {
    throw new Error('xous-core path not set');
  }

  const picked = await vscode.window.showOpenDialog({
    title: 'Select your xous-core folder',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Use this folder'
  });
  if (!picked || picked.length === 0) throw new Error('xous-core path not set');
  const chosen = picked[0].fsPath;
  await setXousCorePath(chosen);
  return chosen;
}

export async function resolveBaoPy(): Promise<string> {
  const root = await ensureXousCorePath();
  const p = path.join(root, 'tools-bao', 'bao.py'); 
  if (!fs.existsSync(p)) throw new Error(`Cannot find tools-bao/bao.py under: ${root}`);
  return p;
}
