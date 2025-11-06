import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as os from 'os';
import { setXousCorePath } from '@services/configService';
import { cloneXousCore } from '@services/cloneXousCore';
import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { REQUIRED_TOOLS_BAO, BAO_VENV_DIR, REQUIREMENTS_FILE, STATE_KEY_REQ_HASH_MAP } from '@constants';

const cfg = () => vscode.workspace.getConfiguration();

function samePath(a: string, b: string) {
  return path.resolve(a) === path.resolve(b);
}

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

export async function ensureXousCorePath(): Promise<string> {
  let p = cfg().get<string>('baochip.xousCorePath') || '';
  if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;

  const choice = await vscode.window.showInformationMessage(
    'Baochip needs your local xous-core folder.',
    { modal: true },
    'Select Folder',
    'Clone from GitHub',
    'Open Repo Page'
  );
  if (!choice) throw new Error('xous-core path not set');

  if (choice === 'Clone from GitHub') {
    const cloned = await cloneXousCore();
    if (!cloned) throw new Error('Clone did not complete.');
    await setXousCorePath(cloned);
    return cloned;
  }

  if (choice === 'Open Repo Page') {
    await vscode.env.openExternal(vscode.Uri.parse('https://github.com/betrusted-io/xous-core'));
    throw new Error('Open the repo, clone locally, then try again.');
  }

  // 'Select Folder'
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


/**
 * Ensure the given `root` (xous-core) is present in the current workspace.
 * Returns:
 *  - 'ready' if already present (you can continue)
 *  - 'added' if we added it to the current multi-root workspace (you can continue)
 *  - 'reopen' if we triggered a window reload via openFolder (STOP your command afterwards)
 */
export async function ensureXousFolderOpen(root: string): Promise<'ready'|'added'|'reopen'> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const hasRoot = folders.some(f => samePath(f.uri.fsPath, root));
  if (hasRoot) return 'ready';

  // Offer options depending on whether the user already has a workspace
  const choices: Array<'Open Here' | 'Add to Workspace' | 'Open in New Window'> =
    folders.length > 0 ? ['Add to Workspace', 'Open Here', 'Open in New Window'] : ['Open Here', 'Open in New Window'];

  const choice = await vscode.window.showInformationMessage(
    'Baochip needs the xous-core folder opened in the workspace to build.',
    { modal: true },
    ...choices
  );
  if (!choice) throw new Error('xous-core workspace not opened');

  const uri = vscode.Uri.file(root);

  if (choice === 'Add to Workspace' && folders.length > 0) {
    vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri, name: 'xous-core' });
    return 'added';
  }

  // Either "Open Here" (same window) or "Open in New Window"
  const newWindow = choice === 'Open in New Window';
  await vscode.commands.executeCommand('vscode.openFolder', uri, newWindow);
  // After this, the extension host reloads / a new window opens; abort current command flow.
  return 'reopen';
}

function normalizeRootKey(root: string): string {
  // Normalize path (and lowercase on Windows) so keys are stable
  const p = path.resolve(root);
  return os.platform() === 'win32' ? p.toLowerCase() : p;
}

function getReqHashMap(ctx: vscode.ExtensionContext): Record<string, string> {
  return (ctx.globalState.get<Record<string, string>>(STATE_KEY_REQ_HASH_MAP)) || {};
}

async function setReqHashForRoot(
  ctx: vscode.ExtensionContext,
  root: string,
  hash: string
): Promise<void> {
  const key = normalizeRootKey(root);
  const map = getReqHashMap(ctx);
  map[key] = hash;
  await ctx.globalState.update(STATE_KEY_REQ_HASH_MAP, map);
}

function getReqHashForRoot(ctx: vscode.ExtensionContext, root: string): string | undefined {
  const key = normalizeRootKey(root);
  const map = getReqHashMap(ctx);
  return map[key];
}

function venvPythonPath(toolsBaoDir: string): string {
  return os.platform() === 'win32'
    ? path.join(toolsBaoDir, BAO_VENV_DIR, 'Scripts', 'python.exe')
    : path.join(toolsBaoDir, BAO_VENV_DIR, 'bin', 'python');
}

function hasVenv(toolsBaoDir: string): boolean {
  return fs.existsSync(venvPythonPath(toolsBaoDir));
}

function hashFile(p: string): string {
  const buf = fs.readFileSync(p);
  return createHash('sha256').update(buf).digest('hex');
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: os.platform() === 'win32' });
    let stderr = '';
    child.stderr.on('data', d => (stderr += d.toString()));
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${cmd} ${args.join(' ')} exited with ${code}`));
    });
  });
}

/** Prefer the venv python under tools-bao if it exists; otherwise fall back to configured python */
export function getBaoPythonCmd(xousRoot: string): string {
  const toolsBao = path.join(xousRoot, 'tools-bao');
  const vpy = venvPythonPath(toolsBao);
  if (fs.existsSync(vpy)) return vpy;
  const configured = getPythonCmd();
  return configured || (os.platform() === 'win32' ? 'py -3' : 'python3');
}

export async function ensureBaoPythonDeps(
  ctx: vscode.ExtensionContext,
  xousRoot: string,
  { quiet = false }: { quiet?: boolean } = {}
): Promise<void> {
  const toolsBaoDir = path.join(xousRoot, 'tools-bao');
  const reqPath = path.join(toolsBaoDir, 'requirements.txt');
  if (!fs.existsSync(reqPath)) return;

  const currentHash = hashFile(reqPath);
  const prevHash = getReqHashForRoot(ctx, xousRoot);
  const needVenv = !hasVenv(toolsBaoDir);
  const needInstall = needVenv || prevHash !== currentHash;

  if (!needInstall) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Baochip: Setting up Python environment…', cancellable: false },
    async () => {
      const sysPy = await ensurePythonCmd();
      if (needVenv) await run(sysPy, ['-m', 'venv', '.venv'], toolsBaoDir);

      const vpy = venvPythonPath(toolsBaoDir);
      await run(vpy, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'], toolsBaoDir);
      await run(vpy, ['-m', 'pip', 'install', '--force-reinstall', '-r', 'requirements.txt'], toolsBaoDir);

      await setReqHashForRoot(ctx, xousRoot, currentHash);  // <— store per-root
      if (!quiet) vscode.window.showInformationMessage('Baochip: Python dependencies installed.');
    }
  );
}
