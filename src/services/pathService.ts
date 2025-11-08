import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { spawn, spawnSync } from 'child_process';
import * as os from 'os';
import { setXousCorePath } from '@services/configService';
import { cloneXousCore } from '@services/cloneXousCore';
import { createHash } from 'crypto';
import { REQUIREMENTS_FILE } from '@constants';

let _ctx: vscode.ExtensionContext | undefined;

export function setExtensionContext(ctx: vscode.ExtensionContext) { _ctx = ctx; }
function ctx(): vscode.ExtensionContext {
  // Developer-facing; left literal on purpose.
  if (!_ctx) throw new Error('Baochip extension context not set. Call setExtensionContext(context) in activate().');
  return _ctx!;
}

/* ------------------------------ utilities ------------------------------ */
function samePath(a: string, b: string) { return path.resolve(a) === path.resolve(b); }

function run(cmd: string, args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, shell: os.platform() === 'win32' });
    let stdout = '', stderr = '';
    p.stdout.on('data', d => { stdout += d.toString(); });
    p.stderr.on('data', d => { stderr += d.toString(); });
    p.on('close', code => {
      code === 0 ? resolve() : reject(new Error(stderr || stdout || `${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}

function spawnVersion(cmd: string, args: string[] = ['--version']): { ok: boolean; out: string } {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', shell: true });
    const out = ((r.stdout || '') + (r.stderr || '')).trim();
    return { ok: r.status === 0, out };
  } catch {
    return { ok: false, out: '' };
  }
}

/** Minimal multi-line Python eval: temp .py file and executes it (no shell). */
function pyEval(pythonCmd: string, code: string): { ok: boolean; out: string } {
  try {
    const parts = pythonCmd.split(' ').filter(Boolean);
    const exe = parts[0];
    const baseArgs = parts.slice(1);

    const tmpDir = path.join(os.tmpdir(), 'baochip-pyeval');
    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}
    const tmpFile = path.join(tmpDir, `snippet-${Date.now()}-${Math.random().toString(36).slice(2)}.py`);
    fs.writeFileSync(tmpFile, code, 'utf8');

    const args = [...baseArgs, tmpFile];
    const res = spawnSync(exe, args, { encoding: 'utf8', shell: false });

    try { fs.unlinkSync(tmpFile); } catch {}

    const stdout = (res.stdout || '').trim();
    return { ok: res.status === 0, out: stdout };
  } catch {
    return { ok: false, out: '' };
  }
}

function normalizeRootKey(root: string): string {
  const p = path.resolve(root);
  return os.platform() === 'win32' ? p.toLowerCase() : p;
}

/* ------------------------------ xous helpers ------------------------------ */
export async function ensureXousCorePath(): Promise<string> {
  const cfg = vscode.workspace.getConfiguration('');
  let p = cfg.get<string>('baochip.xousCorePath') || '';
  if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;

  const choice = await vscode.window.showInformationMessage(
    vscode.l10n.t('xous.needFolder'),
    { modal: true },
    vscode.l10n.t('button.selectFolder'),
    vscode.l10n.t('button.cloneFromGitHub'),
    vscode.l10n.t('button.openRepoPage')
  );
  if (!choice) throw new Error(vscode.l10n.t('xous.pathNotSet'));

  if (choice === vscode.l10n.t('button.cloneFromGitHub')) {
    const cloned = await cloneXousCore();
    if (!cloned) throw new Error(vscode.l10n.t('clone.notCompleted'));
    await setXousCorePath(cloned);
    return cloned;
  }

  if (choice === vscode.l10n.t('button.openRepoPage')) {
    await vscode.env.openExternal(vscode.Uri.parse('https://github.com/betrusted-io/xous-core'));
    throw new Error(vscode.l10n.t('clone.instructionsAfterOpen'));
  }

  const picked = await vscode.window.showOpenDialog({
    title: vscode.l10n.t('xous.selectFolderTitle'),
    canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
    openLabel: vscode.l10n.t('button.useThisFolder')
  });
  if (!picked?.length) throw new Error(vscode.l10n.t('xous.pathNotSet'));
  const chosen = picked[0].fsPath;
  await setXousCorePath(chosen);
  return chosen;
}

/** Return full path to tools-bao/bao.py after verifying xous-core path */
export async function resolveBaoPy(): Promise<string> {
  const root = await ensureXousCorePath();
  const p = path.join(root, 'tools-bao', 'bao.py');
  if (!fs.existsSync(p)) throw new Error(vscode.l10n.t('xous.baoPyMissing', root));
  return p;
}

/** Ensure the given `root` is present in the current workspace. */
export async function ensureXousFolderOpen(root: string): Promise<'ready' | 'added' | 'reopen'> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const hasRoot = folders.some(f => samePath(f.uri.fsPath, root));
  if (hasRoot) return 'ready';

  const openHere = vscode.l10n.t('button.openHere');
  const addToWorkspace = vscode.l10n.t('button.addToWorkspace');
  const openInNewWindow = vscode.l10n.t('button.openInNewWindow');

  const choices: string[] =
    folders.length > 0 ? [addToWorkspace, openHere, openInNewWindow] : [openHere, openInNewWindow];

  const choice = await vscode.window.showInformationMessage(
    vscode.l10n.t('xous.needWorkspaceOpen'),
    { modal: true },
    ...choices
  );
  if (!choice) throw new Error(vscode.l10n.t('xous.workspaceNotOpened'));

  const uri = vscode.Uri.file(root);
  if (choice === addToWorkspace && folders.length > 0) {
    vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri, name: 'xous-core' });
    return 'added';
  }
  const newWindow = choice === openInNewWindow;
  await vscode.commands.executeCommand('vscode.openFolder', uri, newWindow);
  return 'reopen';
}

/* ------------------------------ workspace state ------------------------------ */
const WS_KEY_UV_PYTHON = 'baochip.ws.uvPythonCommand';
const WS_KEY_UV_PATH   = 'baochip.ws.uvBinaryPath';
const WS_KEY_REQ_HASH  = 'baochip.ws.reqHashMap'; // per-root { normalizedRoot => sha256(requirements.txt) }

function wsGet<T>(key: string, def: T): T { return ctx().workspaceState.get<T>(key, def as any) ?? def; }
async function wsSet<T>(key: string, val: T): Promise<void> { await ctx().workspaceState.update(key, val); }

/* ------------------------------ uv bootstrap (binary ONLY) ------------------------------ */
function detectWorkingPythons(): { cmd: string; version: string }[] {
  const cands = os.platform() === 'win32' ? ['py -3', 'py', 'python3', 'python'] : ['python3', 'python'];
  const list: { cmd: string; version: string }[] = [];
  for (const c of cands) {
    const v = spawnVersion(c, ['--version']);
    if (v.ok && v.out.toLowerCase().startsWith('python')) list.push({ cmd: c, version: v.out });
  }
  return list;
}

async function pickPython(): Promise<string> {
  const found = detectWorkingPythons();
  if (found.length === 0) {
    throw new Error(vscode.l10n.t('py.noneFound'));
  }
  const pick = await vscode.window.showQuickPick(
    found.map(w => ({ label: w.cmd, description: w.version })),
    { title: vscode.l10n.t('py.selectForUv'), ignoreFocusOut: true, placeHolder: vscode.l10n.t('py.pickForPipUserUv') }
  );
  if (!pick) throw new Error(vscode.l10n.t('py.selectionCancelled'));
  return pick.label.trim();
}

function uvUsable(uvCmd: string): boolean {
  const r = spawnVersion(uvCmd, ['--version']);
  return r.ok;
}
function whichUvFromPath(): string | null {
  const name = os.platform() === 'win32' ? 'uv.exe' : 'uv';
  return uvUsable(name) ? name : null;
}

function expectedUvPathsFromPython(pythonCmd: string): string[] {
  const probe = `
import sys, sysconfig, site, os, json, pathlib, glob
cands = set()
try:
    p = sysconfig.get_path("scripts")
    if p: cands.add(p)
except Exception: pass
try:
    for sch in sysconfig.get_scheme_names():
        try:
            p = sysconfig.get_path("scripts", sch)
            if p: cands.add(p)
        except Exception:
            pass
except Exception: pass
try:
    ub = getattr(site, "USER_BASE", "") or ""
    if ub:
        cands.add(os.path.join(ub, "Scripts" if os.name=="nt" else "bin"))
except Exception: pass
try:
    us = getattr(site, "USER_SITE", "") or ""
    if us:
        p = pathlib.Path(us).resolve()
        cand = (p.parent / "Scripts")
        cands.add(str(cand))
except Exception: pass
if os.name != "nt":
    cands.add(os.path.join(os.path.expanduser("~"), ".local", "bin"))
if os.name == "nt":
    local = os.environ.get("LOCALAPPDATA") or ""
    if local:
        patt = os.path.join(local, "Packages", "PythonSoftwareFoundation.Python.*",
                            "LocalCache", "local-packages",
                            f"Python{sys.version_info.major}{sys.version_info.minor}", "Scripts")
        for p in glob.glob(patt):
            cands.add(p)
try:
    exe_dir = os.path.dirname(sys.executable)
    if exe_dir:
        cands.add(os.path.join(exe_dir, "Scripts"))
except Exception: pass
if os.name == "nt":
    appdata = os.environ.get("APPDATA") or ""
    if appdata:
        cands.add(os.path.join(appdata, "Python", f"Python{sys.version_info.major}{sys.version_info.minor}", "Scripts"))
exe = "uv.exe" if os.name=="nt" else "uv"
print(json.dumps(sorted(os.path.join(c, exe) for c in cands)))
  `.trim();

  const res = pyEval(pythonCmd, probe);
  let paths: string[] = [];
  if (res.ok && res.out) {
    try { paths = JSON.parse(res.out); } catch { paths = []; }
  }
  try {
    const parts = pythonCmd.split(' ').filter(Boolean);
    const exeOnly = parts[0];
    if (exeOnly && os.platform() === 'win32' && exeOnly.toLowerCase().endsWith('python.exe')) {
      paths.push(path.join(path.dirname(exeOnly), 'Scripts', 'uv.exe'));
    }
  } catch {}
  return Array.from(new Set(paths));
}

/** Install uv using the selected Python, then locate the uv binary. */
async function installUvAndFindBinary(pythonCmd: string): Promise<string> {
  vscode.window.showInformationMessage(vscode.l10n.t('uv.installing'));

  const parts = pythonCmd.split(' ').filter(Boolean);
  const exe = parts[0];
  const args = [...parts.slice(1), '-m', 'pip', 'install', '--user', 'uv'];
  await run(exe, args);

  const cands = expectedUvPathsFromPython(pythonCmd);
  for (const c of cands) {
    if (c && fs.existsSync(c) && uvUsable(c)) return c;
  }

  const onPath = whichUvFromPath();
  if (onPath) return onPath;

  throw new Error(
    os.platform() === 'win32'
      ? vscode.l10n.t('uv.notFoundWin')
      : vscode.l10n.t('uv.notFoundUnix')
  );
}

async function resolveUvBinary(): Promise<string> {
  const saved = wsGet<string | undefined>(WS_KEY_UV_PATH, undefined);
  if (saved && uvUsable(saved)) return saved;

  const fromPath = whichUvFromPath();
  if (fromPath) { await wsSet(WS_KEY_UV_PATH, fromPath); return fromPath; }

  const pythonCmd = await pickPython();
  if (process.platform === 'win32') {
    const sys = pyEval(pythonCmd, 'import platform; print(platform.system())');
    if (sys.ok && sys.out.toLowerCase() === 'linux') {
      throw new Error(vscode.l10n.t('uv.wslPythonPicked'));
    }
  }
  await wsSet(WS_KEY_UV_PYTHON, pythonCmd);

  const uvPath = await installUvAndFindBinary(pythonCmd);
  await wsSet(WS_KEY_UV_PATH, uvPath);
  vscode.window.showInformationMessage(vscode.l10n.t('uv.ready'));
  return uvPath;
}

/* --------------------------- public runners --------------------------- */

/** Returns `{ cmd: <uv binary>, args: ['run','python'] }` */
export async function getBaoRunner(): Promise<{ cmd: string; args: string[] }> {
  const uvPath = await resolveUvBinary();
  return { cmd: uvPath, args: ['run', 'python'] };
}

/**
 * Run tools-bao via uv, never direct Python.
 *   await runBaoCmd(['ports'])
 *   const v = await runBaoCmd(['--version'], root, { capture: true })
 */
export async function runBaoCmd(
  baoArgs: string[],
  cwd?: string,
  opts: { capture?: boolean } = {}
): Promise<string> {
  const { cmd, args } = await getBaoRunner(); // uv + ['run','python']
  const baoPath = await resolveBaoPy();
  const fullArgs = [...args, baoPath, ...baoArgs];
  const shell = os.platform() === 'win32';

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, fullArgs, { cwd, shell });
    let out = '', err = '';
    child.stdout.on('data', d => {
      const s = d.toString();
      if (opts.capture) out += s;
    });
    child.stderr.on('data', d => {
      err += d.toString();
    });
    child.on('close', code => {
      if (code === 0) return resolve(opts.capture ? out.trim() : '');
      const msg = (err || out || `bao.py exited ${code}`).trim();
      reject(new Error(msg));
    });
  });
}

/* --------------------------- deps via uv (pip) --------------------------- */
function fileSha256(p: string): string {
  const buf = fs.readFileSync(p);
  return createHash('sha256').update(buf).digest('hex');
}
function getReqHashMap(): Record<string, string> {
  return wsGet<Record<string, string>>(WS_KEY_REQ_HASH, {});
}
async function setReqHashForRoot(xousRoot: string, hash: string): Promise<void> {
  const map = getReqHashMap();
  map[normalizeRootKey(xousRoot)] = hash;
  await wsSet(WS_KEY_REQ_HASH, map);
}

export async function ensureBaoPythonDeps(
  xousRoot: string,
  { quiet = false }: { quiet?: boolean } = {}
): Promise<void> {
  const reqPath = path.isAbsolute(REQUIREMENTS_FILE)
    ? REQUIREMENTS_FILE
    : path.join(xousRoot, REQUIREMENTS_FILE || path.join('tools-bao', 'requirements.txt'));
  if (!fs.existsSync(reqPath)) return;

  const currentHash = fileSha256(reqPath);
  const prevHash = getReqHashMap()[normalizeRootKey(xousRoot)];
  if (prevHash === currentHash) return;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('deps.installingUv'), cancellable: false },
    async () => {
      const { cmd, args } = await getBaoRunner();
      // Keep CLI tokens literal: 'pip', 'install', '-r'
      await run(cmd, [...args, 'pip', 'install', '-r', reqPath], xousRoot);
      await setReqHashForRoot(xousRoot, currentHash);
    }
  );

  if (!quiet) vscode.window.showInformationMessage(vscode.l10n.t('deps.installed'));
}

/* --------------------------- maintenance helpers --------------------------- */
export async function resetUvSetup() {
  await wsSet(WS_KEY_UV_PATH, undefined as any);
  await wsSet(WS_KEY_UV_PYTHON, undefined as any);
  vscode.window.showInformationMessage(vscode.l10n.t('uv.reset'));
}
