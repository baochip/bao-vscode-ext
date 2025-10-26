import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as os from 'os';
import { setXousCorePath } from '@services/configService';

const cfg = () => vscode.workspace.getConfiguration();

/** Return the configured python command, or an empty string if not set */
export function getPythonCmd(): string {
  return cfg().get<string>('baochip.pythonCommand') || '';
}

/** Try to run `python --version` (or equivalent) to validate the interpreter and return its version string */
function getPythonVersion(cmd: string): string | null {
  try {
    // Handle commands that include arguments like "py -3"
    const parts = cmd.split(' ').filter(Boolean);
    const exe = parts[0];
    const args = [...parts.slice(1), '--version'];
    const res = spawnSync(exe, args, { encoding: 'utf8' });
    const out = (res.stdout || res.stderr || '').trim();
    if (res.status === 0 && out.toLowerCase().startsWith('python')) {
      return out;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Ensure a valid python command is configured.
 * - If none is set, detect and prompt the user to pick one
 * - If set but invalid, re-prompt
 * - Saves the working command to workspace settings
 */
export async function ensurePythonCmd(): Promise<string> {
  let cmd = getPythonCmd();

  // Already set and valid → use it
  const existingVersion = cmd ? getPythonVersion(cmd) : null;
  if (existingVersion) return cmd;

  // Common candidates across platforms
  const candidates =
    os.platform() === 'win32'
      ? ['py -3', 'py', 'python3', 'python']
      : ['python3', 'python'];

  // Collect working interpreters with version strings
  const working = candidates
    .map(c => {
      const ver = getPythonVersion(c);
      return ver ? { cmd: c, version: ver } : null;
    })
    .filter(Boolean) as { cmd: string; version: string }[];

  const quickItems: vscode.QuickPickItem[] = [
    ...working.map(w => ({
      label: w.cmd,
      description: w.version
    })),
    { label: '$(pencil) Enter manually…', description: 'Type a custom path or command' }
  ];

  // If multiple valid interpreters found, highlight python3 if present
  const defaultItem = working.find(w => w.cmd.includes('python3') || w.cmd.includes('-3'));

  const picked = await vscode.window.showQuickPick(quickItems, {
    title: 'Select Python Interpreter for Baochip',
    placeHolder:
      working.length > 0
        ? 'Choose a detected Python interpreter'
        : 'No Python found — please enter manually',
    ignoreFocusOut: true,
    ...(defaultItem ? { activeItem: { label: defaultItem.cmd, description: defaultItem.version } } : {})
  });

  if (!picked) throw new Error('Python interpreter not selected');

  if (picked.label.includes('Enter manually')) {
    const manual = await vscode.window.showInputBox({
      title: 'Enter Python command or full path',
      placeHolder:
        os.platform() === 'win32'
          ? 'e.g., py -3 or C:\\Python312\\python.exe'
          : '/usr/bin/python3',
      ignoreFocusOut: true
    });
    if (!manual) throw new Error('Python interpreter not entered');
    const ver = getPythonVersion(manual.trim());
    if (!ver) throw new Error(`"${manual}" is not a working Python executable.`);
    cmd = manual.trim();
  } else {
    cmd = picked.label.trim();
  }

  await cfg().update('baochip.pythonCommand', cmd );
  vscode.window.showInformationMessage(`Baochip: Python set to "${cmd}"`);
  return cmd;
}

/**
 * Ensure a valid xous-core path is configured.
 * Prompts the user if missing or invalid.
 */
export async function ensureXousCorePath(): Promise<string> {
  let p = cfg().get<string>('baochip.xousCorePath') || '';
  if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;

  const ok = await vscode.window.showInformationMessage(
    'You need to select your local xous-core folder to run tools-bao/bao.py and cargo xtask builds.',
    { modal: true },
    'Select Folder'
  );
  if (ok !== 'Select Folder') throw new Error('xous-core path not set');

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

/** Return full path to tools-bao/bao.py after verifying xous-core path */
export async function resolveBaoPy(): Promise<string> {
  const root = await ensureXousCorePath();
  const p = path.join(root, 'tools-bao', 'bao.py');
  if (!fs.existsSync(p)) throw new Error(`Cannot find tools-bao/bao.py under: ${root}`);
  return p;
}