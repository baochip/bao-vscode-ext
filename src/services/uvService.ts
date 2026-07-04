import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { chan, errorToast, info, log } from '@services/logService';
import { runProcess } from '@services/procService';
import { toMessage } from '@util/error';
import * as vscode from 'vscode';

/* ------------------------------ extension context ------------------------------ */

let _ctx: vscode.ExtensionContext | undefined;

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

/** Absolute path to the installed extension root. */
export function getExtensionRoot(): string {
	return ctx().extensionUri.fsPath;
}

/** Absolute path to the bundled tools-bao directory inside the installed extension. */
export function getBundledToolsRoot(): string {
	return path.join(ctx().extensionUri.fsPath, 'resources', 'tools-bao');
}

/** Absolute path to the extension's global storage directory, used as the uv venv root. */
export function getGlobalVenvRoot(): string {
	return ctx().globalStorageUri.fsPath;
}

/* ------------------------------ workspace state ------------------------------ */

const WS_KEY_UV_PYTHON = 'baochip.ws.uvPythonCommand';
const WS_KEY_UV_PATH = 'baochip.ws.uvBinaryPath';
const WS_KEY_REQ_HASH = 'baochip.ws.reqHash'; // sha256 of bundled requirements.txt

function wsGet<T>(key: string, def: T): T {
	return ctx().workspaceState.get<T>(key, def) ?? def;
}
async function wsSet<T>(key: string, val: T | undefined): Promise<void> {
	await ctx().workspaceState.update(key, val);
}

/* ------------------------------ subprocess utilities ------------------------------ */

/** Run a subprocess; concise logs; only surface stdout/stderr on failure. */
async function run(
	cmd: string,
	args: string[],
	cwd?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
	log(`-> ${cmd} ${args.join(' ')}${cwd ? `  (cwd=${cwd})` : ''}`);
	const r = await runProcess(cmd, args, { cwd });
	if (r.error) {
		const msg = `${cmd} failed to start: ${r.error.message}`;
		log(`ERROR: ${msg}`);
		chan.show(true);
		throw new Error(msg);
	}
	if (r.code === 0) {
		log(`[ok] ${cmd} exited 0`);
		return { stdout: r.stdout, stderr: r.stderr, code: 0 };
	}
	const msg = `${cmd} failed (exit ${r.code})\n${r.stderr || r.stdout || ''}`.trim();
	log(`ERROR: ${msg}`);
	chan.show(true);
	throw new Error(msg);
}

function spawnVersion(cmd: string, args: string[] = ['--version']): { ok: boolean; out: string } {
	try {
		const r = spawnSync(cmd, args, { encoding: 'utf8', shell: true });
		const out = ((r.stdout || '') + (r.stderr || '')).trim();
		return { ok: r.status === 0, out };
	} catch (e: unknown) {
		const message = toMessage(e);
		return { ok: false, out: message };
	}
}

/** Minimal multi-line Python eval: temp .py file and executes it (no shell). */
function pyEval(pythonCmd: string, code: string): { ok: boolean; out: string } {
	try {
		const parts = pythonCmd.split(' ').filter(Boolean);
		const exe = parts[0];
		const baseArgs = parts.slice(1);

		// Unique per-run dir (owner-only perms on POSIX), removed in finally so nothing is left behind.
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baochip-pyeval-'));
		try {
			const tmpFile = path.join(tmpDir, 'snippet.py');
			fs.writeFileSync(tmpFile, code, 'utf8');

			const res = spawnSync(exe, [...baseArgs, tmpFile], { encoding: 'utf8', shell: false });
			const stdout = ((res.stdout || '') + (res.stderr || '')).trim();
			return { ok: res.status === 0, out: stdout };
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	} catch (e: unknown) {
		const message = toMessage(e);
		return { ok: false, out: message };
	}
}

/* ------------------------------ uv bootstrap ------------------------------ */

function detectWorkingPythons(): { cmd: string; version: string }[] {
	const cands =
		process.platform === 'win32' ? ['py -3', 'py', 'python3', 'python'] : ['python3', 'python'];
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
		errorToast(
			vscode.l10n.t(
				'No working Python interpreters detected on PATH. Please install Python (python.org) and retry.',
			),
		);
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
	const name = process.platform === 'win32' ? 'uv.exe' : 'uv';
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
		if (exeOnly && process.platform === 'win32' && exeOnly.toLowerCase().endsWith('python.exe')) {
			paths.push(path.join(path.dirname(exeOnly), 'Scripts', 'uv.exe'));
		}
	} catch {}
	log(`uv probe paths (from ${pythonCmd}):\n  ${paths.join('\n  ')}`);
	return Array.from(new Set(paths));
}

/** Install uv using the selected Python, then locate the uv binary. */
async function installUvAndFindBinary(pythonCmd: string): Promise<string> {
	info(vscode.l10n.t('Baochip: Installing uv...'));
	const parts = pythonCmd.split(' ').filter(Boolean);
	const exe = parts[0];
	const args = [...parts.slice(1), '-m', 'pip', 'install', '--user', 'uv'];
	try {
		await run(exe, args);
	} catch (e: unknown) {
		const message = toMessage(e);
		errorToast(vscode.l10n.t('Baochip: Failed to install uv via pip.\n{0}', message));
		throw e;
	}

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
		process.platform === 'win32'
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
		info(vscode.l10n.t('Baochip: uv ready.'));
		return fromPath;
	}

	const pythonCmd = await pickPython();
	if (process.platform === 'win32') {
		const sys = pyEval(pythonCmd, 'import platform; print(platform.system())');
		if (sys.ok && sys.out.toLowerCase() === 'linux') {
			const msg = vscode.l10n.t(
				'That Python appears to be WSL/Linux. Please pick a Windows Python (e.g., "py -3" or a Windows python.exe).',
			);
			errorToast(msg);
			throw new Error(msg);
		}
	}
	await wsSet(WS_KEY_UV_PYTHON, pythonCmd);
	log(`Saving Python for uv bootstrap: ${pythonCmd}`);

	const uvPath = await installUvAndFindBinary(pythonCmd);
	await wsSet(WS_KEY_UV_PATH, uvPath);
	info(vscode.l10n.t('Baochip: uv ready.'));
	return uvPath;
}

/* ------------------------------ public API ------------------------------ */

/** Returns `{ cmd: <uv binary>, args: ['run','python'] }` */
export async function getBaoRunner(): Promise<{ cmd: string; args: string[] }> {
	const uvPath = await resolveUvBinary();
	log(`Bao runner: ${uvPath} run python`);
	return { cmd: uvPath, args: ['run', 'python'] };
}

export async function ensureBaoPythonDeps({
	quiet = false,
}: {
	quiet?: boolean;
} = {}): Promise<void> {
	const toolsRoot = getBundledToolsRoot();
	const venvRoot = getGlobalVenvRoot();
	const reqPath = path.join(toolsRoot, 'requirements.txt');
	const venvDir = path.join(venvRoot, '.venv');

	if (!fs.existsSync(reqPath)) {
		log(`No requirements file found at: ${reqPath} (skipping install)`);
		return;
	}

	// Ensure the global storage directory exists before creating the venv there.
	fs.mkdirSync(venvRoot, { recursive: true });

	const currentHash = createHash('sha256').update(fs.readFileSync(reqPath)).digest('hex');
	const prevHash = wsGet<string>(WS_KEY_REQ_HASH, '');
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
	if (!quiet) info(`Baochip: ${reason} - installing Python deps...`);

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Installing Python deps (uv)...'),
			cancellable: false,
		},
		async () => {
			const uv = await resolveUvBinary();

			// 1) Ensure (or recreate) the venv in global storage (idempotent)
			try {
				await run(uv, ['venv'], venvRoot);
			} catch (e: unknown) {
				const message = toMessage(e);
				log(`uv venv failed: ${message}`);
				errorToast(vscode.l10n.t('Failed to create uv venv:\n{0}', message));
				throw e;
			}

			// 2) Install requirements into that venv
			try {
				await run(uv, ['pip', 'install', '-r', reqPath], venvRoot);
			} catch (e: unknown) {
				const message = toMessage(e);
				errorToast(vscode.l10n.t('Baochip: Failed installing Python deps via uv.\n{0}', message));
				throw e;
			}

			// 3) Cache the current hash
			await wsSet(WS_KEY_REQ_HASH, currentHash);
			log(`requirements hash updated: ${currentHash}`);
		},
	);

	if (!quiet) info(vscode.l10n.t('Baochip: Python dependencies installed (uv).'));
}

export async function resetUvSetup() {
	await wsSet<string | undefined>(WS_KEY_UV_PATH, undefined);
	await wsSet<string | undefined>(WS_KEY_UV_PYTHON, undefined);
	info(
		vscode.l10n.t('Baochip: reset uv setup for this workspace. Re-run a command to reconfigure.'),
	);
	log(`PATH snapshot:\n${process.env.PATH || ''}`);
}
