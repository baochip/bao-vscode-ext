import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BAO_VENV_DIR, REQUIREMENTS_FILE } from '@constants';
import { cloneXousCore } from '@services/cloneXousCore';
import { setXousCorePath } from '@services/configService';
import * as vscode from 'vscode';

let _ctx: vscode.ExtensionContext | undefined;

/* ------------------------------ logging (quiet) ------------------------------ */
const chan = vscode.window.createOutputChannel('Baochip');

function log(msg: string) {
	const stamp = new Date().toISOString();
	chan.appendLine(`[${stamp}] ${msg}`);
}
function info(msg: string) {
	log(`INFO: ${msg}`);
	vscode.window.showInformationMessage(msg);
}
function warn(msg: string) {
	log(`WARN: ${msg}`);
	vscode.window.showWarningMessage(msg);
}
function errorToast(msg: string) {
	log(`ERROR: ${msg}`);
	chan.show(true);
	vscode.window.showErrorMessage(msg);
}

export function setExtensionContext(ctx: vscode.ExtensionContext) {
	_ctx = ctx;
}
function ctx(): vscode.ExtensionContext {
	// Developer-facing; left literal on purpose.
	if (!_ctx)
		throw new Error(
			'Baochip extension context not set. Call setExtensionContext(context) in activate().',
		);
	return _ctx;
}

/* ------------------------------ utilities ------------------------------ */
function samePath(a: string, b: string) {
	return path.resolve(a) === path.resolve(b);
}

/** Run a subprocess; concise logs; only surface stdout/stderr on failure. */
function run(
	cmd: string,
	args: string[],
	cwd?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
	log(`→ ${cmd} ${args.join(' ')}${cwd ? `  (cwd=${cwd})` : ''}`);
	return new Promise((resolve, reject) => {
		const p = spawn(cmd, args, { cwd, shell: os.platform() === 'win32' });
		let stdout = '';
		let stderr = '';
		p.stdout.on('data', (d) => {
			stdout += d.toString();
		});
		p.stderr.on('data', (d) => {
			stderr += d.toString();
		});
		p.on('close', (code) => {
			if (code === 0) {
				log(`✓ ${cmd} exited 0`);
				resolve({ stdout, stderr, code });
			} else {
				const msg = `${cmd} failed (exit ${code})\n${stderr || stdout || ''}`.trim();
				errorToast(msg);
				reject(new Error(msg));
			}
		});
	});
}

function spawnVersion(cmd: string, args: string[] = ['--version']): { ok: boolean; out: string } {
	try {
		const r = spawnSync(cmd, args, { encoding: 'utf8', shell: true });
		const out = ((r.stdout || '') + (r.stderr || '')).trim();
		return { ok: r.status === 0, out };
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		return { ok: false, out: message };
	}
}

/** Minimal multi-line Python eval: temp .py file and executes it (no shell). */
function pyEval(pythonCmd: string, code: string): { ok: boolean; out: string } {
	try {
		const parts = pythonCmd.split(' ').filter(Boolean);
		const exe = parts[0];
		const baseArgs = parts.slice(1);

		const tmpDir = path.join(os.tmpdir(), 'baochip-pyeval');
		try {
			fs.mkdirSync(tmpDir, { recursive: true });
		} catch {}
		const tmpFile = path.join(
			tmpDir,
			`snippet-${Date.now()}-${Math.random().toString(36).slice(2)}.py`,
		);
		fs.writeFileSync(tmpFile, code, 'utf8');

		const args = [...baseArgs, tmpFile];
		const res = spawnSync(exe, args, { encoding: 'utf8', shell: false });

		try {
			fs.unlinkSync(tmpFile);
		} catch {}

		const stdout = ((res.stdout || '') + (res.stderr || '')).trim();
		return { ok: res.status === 0, out: stdout };
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		return { ok: false, out: message };
	}
}

function normalizeRootKey(root: string): string {
	const p = path.resolve(root);
	return os.platform() === 'win32' ? p.toLowerCase() : p;
}

/* ------------------------------ xous helpers ------------------------------ */
export async function ensureXousCorePath(): Promise<string> {
	const cfg = vscode.workspace.getConfiguration('');
	const p = cfg.get<string>('baochip.xousCorePath') || '';
	if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) {
		log(`xous-core path (cached): ${p}`);
		return p;
	}

	const choice = await vscode.window.showInformationMessage(
		vscode.l10n.t('Baochip needs your local xous-core folder.'),
		{ modal: true },
		vscode.l10n.t('Select Folder'),
		vscode.l10n.t('Clone from GitHub'),
		vscode.l10n.t('Open Repo Page'),
	);
	if (!choice) throw new Error(vscode.l10n.t('xous-core path not set'));

	if (choice === vscode.l10n.t('Clone from GitHub')) {
		const cloned = await cloneXousCore();
		if (!cloned) throw new Error(vscode.l10n.t('Clone did not complete.'));
		await setXousCorePath(cloned);
		log(`xous-core cloned to: ${cloned}`);
		return cloned;
	}

	if (choice === vscode.l10n.t('Open Repo Page')) {
		await vscode.env.openExternal(vscode.Uri.parse('https://github.com/betrusted-io/xous-core'));
		throw new Error(vscode.l10n.t('Open the repo, clone locally, then try again.'));
	}

	const picked = await vscode.window.showOpenDialog({
		title: vscode.l10n.t('Select your xous-core folder'),
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: vscode.l10n.t('Use this folder'),
	});
	if (!picked?.length) throw new Error(vscode.l10n.t('xous-core path not set'));
	const chosen = picked[0].fsPath;
	await setXousCorePath(chosen);
	log(`xous-core chosen: ${chosen}`);
	return chosen;
}

/** Return full path to tools-bao/bao.py after verifying xous-core path */
export async function resolveBaoPy(xousRoot?: string): Promise<string> {
	const root = xousRoot ?? (await ensureXousCorePath());
	const p = path.join(root, 'tools-bao', 'bao.py');
	if (!fs.existsSync(p)) {
		const msg = `Cannot find tools-bao/bao.py under: ${root}`;
		errorToast(msg);
		throw new Error(msg);
	}
	log(`bao.py resolved: ${p}`);
	return p;
}

/** Ensure the given `root` is present in the current workspace. */
export async function ensureXousFolderOpen(root: string): Promise<'ready' | 'added' | 'reopen'> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	const hasRoot = folders.some((f) => samePath(f.uri.fsPath, root));
	if (hasRoot) {
		log('xous-core already in workspace.');
		return 'ready';
	}

	const openHere = vscode.l10n.t('Open Here');
	const addToWorkspace = vscode.l10n.t('Add to Workspace');
	const openInNewWindow = vscode.l10n.t('Open in New Window');

	const choices: string[] =
		folders.length > 0 ? [addToWorkspace, openHere, openInNewWindow] : [openHere, openInNewWindow];

	const choice = await vscode.window.showInformationMessage(
		vscode.l10n.t('Baochip needs the xous-core folder opened in the workspace to build.'),
		{ modal: true },
		...choices,
	);
	if (!choice) throw new Error(vscode.l10n.t('xous-core workspace not opened'));

	const uri = vscode.Uri.file(root);
	if (choice === addToWorkspace && folders.length > 0) {
		vscode.workspace.updateWorkspaceFolders(folders.length, 0, { uri, name: 'xous-core' });
		log('xous-core added to current workspace.');
		return 'added';
	}
	const newWindow = choice === openInNewWindow;
	await vscode.commands.executeCommand('vscode.openFolder', uri, newWindow);
	log(`xous-core opened (${newWindow ? 'new window' : 'here'}).`);
	return 'reopen';
}

/* ------------------------------ workspace state ------------------------------ */
const WS_KEY_UV_PYTHON = 'baochip.ws.uvPythonCommand';
const WS_KEY_UV_PATH = 'baochip.ws.uvBinaryPath';
const WS_KEY_REQ_HASH = 'baochip.ws.reqHashMap'; // per-root { normalizedRoot => sha256(requirements.txt) }

function wsGet<T>(key: string, def: T): T {
	return ctx().workspaceState.get<T>(key, def) ?? def;
}
async function wsSet<T>(key: string, val: T | undefined): Promise<void> {
	await ctx().workspaceState.update(key, val);
}

/* ------------------------------ uv bootstrap (binary ONLY) ------------------------------ */
function detectWorkingPythons(): { cmd: string; version: string }[] {
	const cands =
		os.platform() === 'win32' ? ['py -3', 'py', 'python3', 'python'] : ['python3', 'python'];
	const list: { cmd: string; version: string }[] = [];
	for (const c of cands) {
		const v = spawnVersion(c, ['--version']);
		if (v.ok && v.out.toLowerCase().startsWith('python')) {
			list.push({ cmd: c, version: v.out });
			log(`Python candidate: ${c} -> ${v.out}`);
		} else {
			log(`Python candidate not usable: ${c} (${v.out})`);
		}
	}
	return list;
}

async function pickPython(): Promise<string> {
	const found = detectWorkingPythons();
	if (found.length === 0) {
		const envPath = process.env.PATH || '';
		errorToast('No working Python interpreters detected on PATH. Please install Python and retry.');
		log(`PATH at failure:\n${envPath}`);
		throw new Error(
			'No working Python interpreters detected on PATH. Please install Python (python.org) and retry.',
		);
	}
	const pick = await vscode.window.showQuickPick(
		found.map((w) => ({ label: w.cmd, description: w.version })),
		{
			title: vscode.l10n.t('Select Python to install uv'),
			ignoreFocusOut: true,
			placeHolder: vscode.l10n.t('Pick the Python to run "pip install --user uv"'),
		},
	);
	if (!pick) throw new Error('Python selection cancelled.');
	log(`Python selected for uv install: ${pick.label}`);
	return pick.label.trim();
}

function uvUsable(uvCmd: string): boolean {
	const r = spawnVersion(uvCmd, ['--version']);
	if (r.ok) log(`uv usable: ${uvCmd} -> ${r.out}`);
	else log(`uv unusable: ${uvCmd} (${r.out})`);
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
except Exception as e: pass
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
		try {
			paths = JSON.parse(res.out);
		} catch {
			paths = [];
		}
	}
	try {
		const parts = pythonCmd.split(' ').filter(Boolean);
		const exeOnly = parts[0];
		if (exeOnly && os.platform() === 'win32' && exeOnly.toLowerCase().endsWith('python.exe')) {
			paths.push(path.join(path.dirname(exeOnly), 'Scripts', 'uv.exe'));
		}
	} catch {}
	log(`uv probe paths (from ${pythonCmd}):\n  ${paths.join('\n  ')}`);
	return Array.from(new Set(paths));
}

/** Install uv using the selected Python, then locate the uv binary. */
async function installUvAndFindBinary(pythonCmd: string): Promise<string> {
	info('Baochip: Installing uv…');
	const parts = pythonCmd.split(' ').filter(Boolean);
	const exe = parts[0];
	const args = [...parts.slice(1), '-m', 'pip', 'install', '--user', 'uv'];
	await run(exe, args);

	const cands = expectedUvPathsFromPython(pythonCmd);
	for (const c of cands) {
		if (c && fs.existsSync(c) && uvUsable(c)) {
			log(`uv found at: ${c}`);
			return c;
		}
		log(`uv not at: ${c}`);
	}

	const onPath = whichUvFromPath();
	if (onPath) {
		log(`uv found on PATH: ${onPath}`);
		return onPath;
	}

	const envPath = process.env.PATH || '';
	log(`uv not found after install. PATH:\n${envPath}`);
	throw new Error(
		os.platform() === 'win32'
			? vscode.l10n.t(
					'uv was installed but not found. Ensure your Python user Scripts directory is on PATH or select a different Windows Python.',
				)
			: vscode.l10n.t(
					'uv was installed but not found. Ensure your user bin directory is on PATH or select a different Python.',
				),
	);
}

async function resolveUvBinary(): Promise<string> {
	const saved = wsGet<string | undefined>(WS_KEY_UV_PATH, undefined);
	if (saved && uvUsable(saved)) {
		log(`Using saved uv path: ${saved}`);
		return saved;
	}

	const fromPath = whichUvFromPath();
	if (fromPath) {
		await wsSet(WS_KEY_UV_PATH, fromPath);
		info('Baochip: uv ready.');
		return fromPath;
	}

	const pythonCmd = await pickPython();
	if (process.platform === 'win32') {
		const sys = pyEval(pythonCmd, 'import platform; print(platform.system())');
		if (sys.ok && sys.out.toLowerCase() === 'linux') {
			const msg =
				'That Python appears to be WSL/Linux. Please pick a Windows Python (e.g., "py -3" or a Windows python.exe).';
			errorToast(msg);
			throw new Error(msg);
		}
	}
	await wsSet(WS_KEY_UV_PYTHON, pythonCmd);
	log(`Saving Python for uv bootstrap: ${pythonCmd}`);

	const uvPath = await installUvAndFindBinary(pythonCmd);
	await wsSet(WS_KEY_UV_PATH, uvPath);
	info('Baochip: uv ready.');
	return uvPath;
}

/* --------------------------- public runners --------------------------- */

/** Returns `{ cmd: <uv binary>, args: ['run','python'] }` */
export async function getBaoRunner(): Promise<{ cmd: string; args: string[] }> {
	const uvPath = await resolveUvBinary();
	log(`Bao runner: ${uvPath} run python`);
	return { cmd: uvPath, args: ['run', 'python'] };
}

/**
 * Run tools-bao via uv, never direct Python.
 * Ensures Python deps are installed first and uses repo root as default CWD so uv finds .venv.
 */
export async function runBaoCmd(
	baoArgs: string[],
	cwd?: string,
	opts: { capture?: boolean } = {},
): Promise<string> {
	const { cmd, args } = await getBaoRunner(); // uv + ['run','python']
	const baoPath = await resolveBaoPy();

	// Ensure deps before we run anything
	try {
		const xousRoot = path.dirname(path.dirname(baoPath)); // <root>/tools-bao/bao.py
		await ensureBaoPythonDeps(xousRoot, { quiet: true });
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		warn(`Baochip: dependency check failed, proceeding anyway.\n${message}`);
	}

	const fullArgs = [...args, baoPath, ...baoArgs];
	const shell = os.platform() === 'win32';

	// Default CWD to repo root (so uv discovers .venv at <root>/.venv)
	const xousRoot = path.dirname(path.dirname(baoPath));
	const effectiveCwd = cwd ?? xousRoot;

	log(`bao.py INVOKE: ${cmd} ${fullArgs.join(' ')} ${effectiveCwd ? `(cwd=${effectiveCwd})` : ''}`);

	return new Promise((resolve, reject) => {
		const child = spawn(cmd, fullArgs, { cwd: effectiveCwd, shell });
		let out = '';
		let err = '';
		child.stdout.on('data', (d) => {
			const s = d.toString();
			if (opts.capture) out += s; // keep stdout quiet unless caller wants capture
		});
		child.stderr.on('data', (d) => {
			err += d.toString(); // keep stderr for error surface
		});
		child.on('close', (code) => {
			log(`bao.py EXIT ${code}`);
			if (code === 0) return resolve(opts.capture ? out.trim() : '');
			const msg = (err || out || `bao.py exited ${code}`).trim();
			errorToast(`Baochip: bao.py failed.\n${msg}`);
			reject(new Error(msg));
		});
	});
}

/* --------------------------- deps via uv (pip) --------------------------- */
function _fileSha256(p: string): string {
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
	log(`requirements hash updated for ${xousRoot}: ${hash}`);
}

export async function ensureBaoPythonDeps(
	xousRoot: string,
	{ quiet = false }: { quiet?: boolean } = {},
): Promise<void> {
	const reqPath = path.isAbsolute(REQUIREMENTS_FILE)
		? REQUIREMENTS_FILE
		: path.join(xousRoot, REQUIREMENTS_FILE || path.join('tools-bao', 'requirements.txt'));
	const venvDir = path.join(xousRoot, BAO_VENV_DIR || '.venv');

	if (!fs.existsSync(reqPath)) {
		log(`No requirements file found at: ${reqPath} (skipping install)`);
		return;
	}

	const currentHash = createHash('sha256').update(fs.readFileSync(reqPath)).digest('hex');
	const prevHash = getReqHashMap()[normalizeRootKey(xousRoot)];
	log(`requirements.txt path: ${reqPath}`);
	log(`requirements current hash: ${currentHash}`);
	log(`requirements previous hash: ${prevHash || '(none)'}`);
	log(`checking venv: ${venvDir}`);

	// If the venv folder is missing, remake it and reinstall everything.
	const venvMissing = !fs.existsSync(venvDir);

	if (!venvMissing && prevHash === currentHash) {
		log('requirements unchanged and venv present; skipping install.');
		return;
	}

	const reason = venvMissing ? 'missing virtual environment' : 'requirements changed';
	if (!quiet) info(`Baochip: ${reason} — installing Python deps…`);

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Installing Python deps (uv)…'),
			cancellable: false,
		},
		async () => {
			const uv = await resolveUvBinary();

			// 1) Ensure (or recreate) the venv at <xousRoot>/.venv (idempotent)
			try {
				await run(uv, ['venv'], xousRoot);
			} catch (e: unknown) {
				const message = e instanceof Error ? e.message : String(e);
				log(`uv venv failed: ${message}`);
				errorToast(`Failed to create uv venv:\n${message}`);
				throw e;
			}

			// 2) Install requirements into that venv
			try {
				await run(uv, ['pip', 'install', '-r', reqPath], xousRoot);
			} catch (e: unknown) {
				const message = e instanceof Error ? e.message : String(e);
				errorToast(`Baochip: Failed installing Python deps via uv.\n${message}`);
				throw e;
			}

			// 3) Cache the current hash
			await setReqHashForRoot(xousRoot, currentHash);
		},
	);

	if (!quiet) info('Baochip: Python dependencies installed (uv).');
}

/* --------------------------- maintenance helpers --------------------------- */
export async function resetUvSetup() {
	await wsSet<string | undefined>(WS_KEY_UV_PATH, undefined);
	await wsSet<string | undefined>(WS_KEY_UV_PYTHON, undefined);
	info('Baochip: reset uv setup for this workspace. Re-run a command to reconfigure.');
	log(`PATH snapshot:\n${process.env.PATH || ''}`);
}
