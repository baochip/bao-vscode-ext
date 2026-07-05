import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { downloadFile } from '@services/httpService';
import { chan, errorToast, info, log } from '@services/logService';
import { runProcess } from '@services/procService';
import { toMessage } from '@util/error';
import { isFullPathCommand } from '@util/shell';
import {
	classifyPipFailure,
	containedUvEnv,
	installerScriptUrl,
	knownUvLocations,
	uvPathIn,
	venvPlan,
} from '@util/uvInstall';
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

/* ------------------------------ global state ------------------------------ */

// uv and its venv are machine-global (the venv lives in globalStorage), so these are remembered
// GLOBALLY, not per-workspace - otherwise every new workspace re-runs the whole uv bootstrap.
const KEY_UV_PYTHON = 'baochip.uvPythonCommand';
const KEY_UV_PATH = 'baochip.uvBinaryPath';
const KEY_REQ_HASH = 'baochip.reqHash'; // sha256 of bundled requirements.txt

function gGet<T>(key: string, def: T): T {
	return ctx().globalState.get<T>(key, def) ?? def;
}
async function gSet<T>(key: string, val: T | undefined): Promise<void> {
	await ctx().globalState.update(key, val);
}

/* ------------------------------ subprocess utilities ------------------------------ */

/**
 * Env that forces a Python child to UTF-8 stdio (and filesystem), so its output matches our UTF-8
 * decode even on non-UTF-8 OS locales (e.g. Japanese Windows cp932). Harmless for non-Python procs.
 */
export function pythonUtf8Env(): NodeJS.ProcessEnv {
	return { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
}

/**
 * Base env for every uv invocation: UTF-8 Python stdio plus uv's managed-Python and cache dirs
 * confined to our global storage, so uv never installs a Python or caches downloads outside VS Code.
 */
export function uvEnv(): NodeJS.ProcessEnv {
	return { ...pythonUtf8Env(), ...containedUvEnv(getGlobalVenvRoot()) };
}

/** Run a subprocess; concise logs; only surface stdout/stderr on failure. */
async function run(
	cmd: string,
	args: string[],
	cwd?: string,
	extraEnv?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; code: number }> {
	log(`-> ${cmd} ${args.join(' ')}${cwd ? `  (cwd=${cwd})` : ''}`);
	const r = await runProcess(cmd, args, { cwd, env: { ...uvEnv(), ...extraEnv } });
	if (r.error) {
		const msg = vscode.l10n.t('{0} failed to start: {1}', cmd, r.error.message);
		log(`ERROR: ${msg}`);
		chan.show(true);
		throw new Error(msg);
	}
	if (r.code === 0) {
		log(`[ok] ${cmd} exited 0`);
		return { stdout: r.stdout, stderr: r.stderr, code: 0 };
	}
	const msg = `${vscode.l10n.t('{0} failed (exit {1})', cmd, String(r.code))}\n${
		r.stderr || r.stdout || ''
	}`.trim();
	log(`ERROR: ${msg}`);
	chan.show(true);
	throw new Error(msg);
}

function spawnVersion(cmd: string, args: string[] = ['--version']): { ok: boolean; out: string } {
	try {
		// A full path (contains a path separator) runs WITHOUT a shell so spaces/metacharacters in
		// the path pass through natively. Bare names ('uv', 'py -3') keep the shell for PATH/PATHEXT
		// resolution. Using shell:true on a spaced full path would split it at the first space
		// (Node DEP0190) and falsely report the binary as unusable.
		const useShell = !isFullPathCommand(cmd);
		const r = spawnSync(cmd, args, { encoding: 'utf8', shell: useShell, env: pythonUtf8Env() });
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

			const res = spawnSync(exe, [...baseArgs, tmpFile], {
				encoding: 'utf8',
				shell: false,
				env: pythonUtf8Env(),
			});
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

/** Astral's uv installation guide, offered when uv is required but auto-install failed. */
const UV_INSTALL_DOCS = 'https://docs.astral.sh/uv/getting-started/installation/';

/**
 * Show the terminal "uv is required" error (with a button to uv's install guide) and throw.
 * Reached only when every automatic path to uv has failed. A user who then installs uv themselves
 * is detected automatically on the next command (resolveUvBinary steps 2-3), no reset needed.
 */
async function promptUvRequired(): Promise<never> {
	const msg = vscode.l10n.t(
		'Baochip requires uv but could not install it automatically. Install uv yourself (see the uv installation guide), then run a Baochip command again - it will detect uv automatically.',
	);
	const openLabel = vscode.l10n.t('Open uv installation guide');
	const choice = await vscode.window.showErrorMessage(msg, openLabel);
	if (choice === openLabel) {
		await vscode.env.openExternal(vscode.Uri.parse(UV_INSTALL_DOCS));
	}
	throw new Error(msg);
}

async function pickPython(): Promise<string> {
	const found = detectWorkingPythons();
	if (found.length === 0) {
		// The standalone installer has already failed and there is no Python for the pip fallback, so
		// every automatic path to uv is exhausted. uv - not Python - is what we actually require.
		log(`PATH at failure:\n${process.env.PATH || ''}`);
		return await promptUvRequired();
	}
	const pick = await vscode.window.showQuickPick(
		found.map((w) => ({ label: w.cmd, description: w.version })),
		{
			title: vscode.l10n.t('Select Python to install uv'),
			ignoreFocusOut: true,
			placeHolder: vscode.l10n.t('Pick the Python to run "pip install --user uv"'),
		},
	);
	if (!pick) throw new Error(vscode.l10n.t('Python selection cancelled.'));
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

/** Map a pip-install failure (its stderr) to concise, localized, actionable guidance. */
function pipInstallFailedMessage(stderr: string): string {
	let hint: string;
	switch (classifyPipFailure(stderr)) {
		case 'pep668':
			hint = vscode.l10n.t(
				'This Python is externally managed (PEP 668), so pip will not install into it. Try a different Python, or install uv with its standalone installer or pipx.',
			);
			break;
		case 'no-pip':
			hint = vscode.l10n.t(
				'The selected Python has no pip. Run "python -m ensurepip --upgrade", or pick a different Python.',
			);
			break;
		case 'ssl':
			hint = vscode.l10n.t(
				'TLS verification failed, usually a corporate proxy intercepting HTTPS. Ask your IT team for the proxy root certificate and set the SSL_CERT_FILE environment variable, then retry.',
			);
			break;
		case 'network':
			hint = vscode.l10n.t(
				'Could not reach PyPI. Check your network, set HTTP_PROXY/HTTPS_PROXY if you use a proxy, then retry.',
			);
			break;
		default:
			hint = vscode.l10n.t(
				'This usually means no network, a proxy or firewall blocking PyPI, or a broken pip. Check your connection and proxy, then retry.',
			);
			break;
	}
	return vscode.l10n.t('Baochip: could not install uv with pip. {0}', hint);
}

/** Resolve the saved bootstrap Python (e.g. "py -3") to its actual executable path, or undefined. */
function resolvePickedPythonExe(): string | undefined {
	const pythonCmd = gGet<string | undefined>(KEY_UV_PYTHON, undefined);
	if (!pythonCmd) return undefined;
	const r = pyEval(pythonCmd, 'import sys; print(sys.executable)');
	const exe = r.ok ? r.out.trim() : '';
	return exe && fs.existsSync(exe) ? exe : undefined;
}

/**
 * Directory into which WE install a self-contained uv. Lives inside the extension's global storage
 * (alongside the venv), so nothing is written to the user's home directory or PATH.
 */
function ownUvDir(): string {
	return path.join(getGlobalVenvRoot(), 'uv');
}

/**
 * uv paths to probe inside our own install dir. The standalone installer's UV_INSTALL_DIR layout
 * has varied by version (binary directly in the dir, or under a `bin/` subdir), so we check both.
 */
function ownUvCandidates(): string[] {
	const dir = ownUvDir();
	return [uvPathIn(dir), uvPathIn(path.join(dir, 'bin'))];
}

/** Remove a directory tree, ignoring errors (best-effort temp cleanup). */
function cleanupDir(dir: string): void {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {}
}

/**
 * Proxy env overlay so the installer's own downloads honor a corporate proxy: VS Code's `http.proxy`
 * setting if configured, else the standard proxy env vars. Empty when no proxy is in play.
 */
function proxyEnv(): NodeJS.ProcessEnv {
	const configured = vscode.workspace.getConfiguration('http').get<string>('proxy')?.trim();
	const proxy =
		configured ||
		process.env.HTTPS_PROXY ||
		process.env.https_proxy ||
		process.env.HTTP_PROXY ||
		process.env.http_proxy;
	return proxy ? { HTTPS_PROXY: proxy, HTTP_PROXY: proxy } : {};
}

/**
 * Install uv with Astral's standalone installer into our own global storage, needing no Python.
 * Fully contained: UV_INSTALL_DIR points at our dir and INSTALLER_NO_MODIFY_PATH stops it from
 * editing the user's PATH. Returns the uv path on success, or null so the caller can fall back.
 */
async function installUvViaStandalone(): Promise<string | null> {
	const dir = ownUvDir();
	try {
		fs.mkdirSync(dir, { recursive: true });
	} catch (e: unknown) {
		log(`could not create uv install dir ${dir}: ${toMessage(e)}`);
		return null;
	}

	const isWin = process.platform === 'win32';
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bao-uv-'));
	const scriptPath = path.join(tmpDir, isWin ? 'install.ps1' : 'install.sh');

	info(vscode.l10n.t('Baochip: Installing uv (standalone installer)...'));
	try {
		// Shared downloader: timeout, capped redirects, atomic write. In-process requests go
		// through VS Code's extension-host proxy handling; proxyEnv() below covers only the
		// installer SUBPROCESS, whose own downloads bypass that handling.
		await downloadFile(installerScriptUrl(), scriptPath);
	} catch (e: unknown) {
		log(`uv installer download failed: ${toMessage(e)}`);
		cleanupDir(tmpDir);
		return null;
	}

	// Contained install: land uv inside our storage and never touch the user's PATH.
	const installEnv: NodeJS.ProcessEnv = {
		...pythonUtf8Env(),
		...proxyEnv(),
		UV_INSTALL_DIR: dir,
		INSTALLER_NO_MODIFY_PATH: '1',
	};

	// We invoke the script THROUGH the interpreter (powershell -File / sh <file>), so no execute bit
	// is needed. powershell.exe (Windows PowerShell 5.1) is used for the broadest compatibility.
	const [cmd, args] = isWin
		? ['powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]]
		: ['sh', [scriptPath]];

	log(`-> ${cmd} ${(args as string[]).join(' ')}`);
	const r = await runProcess(cmd as string, args as string[], { env: installEnv });
	cleanupDir(tmpDir);
	if (r.error || r.code !== 0) {
		log(
			`uv standalone installer failed: ${r.error?.message ?? `exit ${r.code}`}\n${(
				r.stderr || r.stdout || ''
			).trim()}`,
		);
		return null;
	}

	for (const cand of ownUvCandidates()) {
		if (fs.existsSync(cand) && uvUsable(cand)) {
			log(`uv installed (standalone) at: ${cand}`);
			return cand;
		}
	}
	const onPath = whichUvFromPath();
	if (onPath) {
		log(`uv installed (standalone), found on PATH: ${onPath}`);
		return onPath;
	}
	log('uv standalone installer completed but uv was not found in the expected locations');
	return null;
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
		errorToast(pipInstallFailedMessage(toMessage(e)));
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

	log(`uv not found after install. PATH:\n${process.env.PATH || ''}`);

	// Recoverable: name the expected dir and let the user open it or point us at uv directly.
	const expectedDir = cands.length > 0 ? path.dirname(cands[0]) : '';
	const notFoundMsg = vscode.l10n.t(
		'uv was installed but Baochip could not locate the uv executable. Expected it in: {0}. Add that folder to PATH, or use "Enter uv path" to point Baochip at it directly.',
		expectedDir || '(unknown)',
	);
	const openLabel = vscode.l10n.t('Open Folder');
	const enterLabel = vscode.l10n.t('Enter uv path');
	const buttons = expectedDir ? [openLabel, enterLabel] : [enterLabel];
	const choice = await vscode.window.showErrorMessage(notFoundMsg, ...buttons);
	if (choice === enterLabel) {
		const entered = await vscode.window.showInputBox({
			title: vscode.l10n.t('Enter the full path to the uv executable'),
			ignoreFocusOut: true,
		});
		const trimmed = entered?.trim();
		if (trimmed && uvUsable(trimmed)) {
			log(`uv path entered manually: ${trimmed}`);
			return trimmed;
		}
		throw new Error(vscode.l10n.t('That uv path is not usable.'));
	}
	if (choice === openLabel && expectedDir) {
		await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(expectedDir));
	}
	throw new Error(vscode.l10n.t('uv setup was not completed.'));
}

/*
 * Session cache: without it every command re-probes uv with a synchronous `--version` (and
 * re-hashes requirements.txt), and the pipeline's port wait triggers that every 500ms - each
 * probe blocks the extension host. Cleared by resetUvSetup/rerunExtensionSetup. The probe
 * itself stays synchronous by design: it now runs once per session, and making it async would
 * ripple into the deliberately-deferred shell:true version probes.
 */
let sessionUvPath: string | undefined;
let sessionDepsOk = false;

async function resolveUvBinary(): Promise<string> {
	if (sessionUvPath) return sessionUvPath;
	sessionUvPath = await resolveUvBinaryUncached();
	return sessionUvPath;
}

async function resolveUvBinaryUncached(): Promise<string> {
	// 1) A uv we already resolved (saved in our own global state).
	const saved = gGet<string | undefined>(KEY_UV_PATH, undefined);
	if (saved && uvUsable(saved)) {
		log(`Using saved uv path: ${saved}`);
		return saved;
	}

	// 2) A uv already installed globally (on PATH) - reuse it rather than installing our own.
	const fromPath = whichUvFromPath();
	if (fromPath) {
		await gSet(KEY_UV_PATH, fromPath);
		info(vscode.l10n.t('Baochip: uv ready.'));
		return fromPath;
	}

	// 3) A uv we installed before, or a user standalone/cargo install, found by full path.
	for (const cand of [...ownUvCandidates(), ...knownUvLocations(os.homedir())]) {
		if (fs.existsSync(cand) && uvUsable(cand)) {
			log(`Found existing uv at: ${cand}`);
			await gSet(KEY_UV_PATH, cand);
			info(vscode.l10n.t('Baochip: uv ready.'));
			return cand;
		}
	}

	// 4) Install uv, self-contained, needing no Python (Astral standalone installer).
	const viaStandalone = await installUvViaStandalone();
	if (viaStandalone) {
		await gSet(KEY_UV_PATH, viaStandalone);
		info(vscode.l10n.t('Baochip: uv ready.'));
		return viaStandalone;
	}

	// 5) Last resort: install uv into the user's own Python with pip.
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
	await gSet(KEY_UV_PYTHON, pythonCmd);
	log(`Saving Python for uv bootstrap: ${pythonCmd}`);

	const uvPath = await installUvAndFindBinary(pythonCmd);
	await gSet(KEY_UV_PATH, uvPath);
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
	if (sessionDepsOk) return; // verified earlier this session (see the cache note above)

	const toolsRoot = getBundledToolsRoot();
	const venvRoot = getGlobalVenvRoot();
	const reqPath = path.join(toolsRoot, 'requirements.txt');
	const venvDir = path.join(venvRoot, '.venv');

	if (!fs.existsSync(reqPath)) {
		log(`No requirements file found at: ${reqPath} (skipping install)`);
		sessionDepsOk = true;
		return;
	}

	// Ensure the global storage directory exists before creating the venv there.
	fs.mkdirSync(venvRoot, { recursive: true });

	const currentHash = createHash('sha256').update(fs.readFileSync(reqPath)).digest('hex');
	const prevHash = gGet<string>(KEY_REQ_HASH, '');
	log(`requirements.txt path: ${reqPath}`);
	log(`requirements current hash: ${currentHash}`);
	log(`requirements previous hash: ${prevHash || '(none)'}`);
	log(`checking venv: ${venvDir}`);

	// If the venv folder is missing OR half-built (no pyvenv.cfg, e.g. an interrupted create),
	// remake it and reinstall everything.
	const venvMissing = !fs.existsSync(venvDir) || !fs.existsSync(path.join(venvDir, 'pyvenv.cfg'));

	if (!venvMissing && prevHash === currentHash) {
		log('requirements unchanged and venv present; skipping install.');
		sessionDepsOk = true;
		return;
	}

	if (!quiet) {
		info(
			venvMissing
				? vscode.l10n.t('Baochip: missing virtual environment - installing Python deps...')
				: vscode.l10n.t('Baochip: requirements changed - installing Python deps...'),
		);
	}

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Installing Python deps (uv)...'),
			cancellable: false,
		},
		async () => {
			const uv = await resolveUvBinary();

			// Choose the venv interpreter: a Python we picked, else any system Python, else a managed
			// Python that uv downloads for us (confined to our storage via uvEnv). Only the last case
			// downloads, so users who already have a Python are never made to fetch one.
			const plan = venvPlan(resolvePickedPythonExe(), detectWorkingPythons().length > 0);

			// 0) No system Python: have uv install a self-contained one before creating the venv.
			if (plan.managed) {
				if (!quiet) {
					info(
						vscode.l10n.t(
							'Baochip: no Python found - downloading a Python runtime (one-time, ~150 MB)...',
						),
					);
				}
				try {
					await run(uv, ['python', 'install'], venvRoot, { UV_PYTHON_DOWNLOADS: 'automatic' });
				} catch (e: unknown) {
					const message = toMessage(e);
					log(`uv python install failed: ${message}`);
					errorToast(
						vscode.l10n.t(
							'Baochip could not download a Python runtime. Check your network and any proxy or firewall, then retry.\n{0}',
							message,
						),
					);
					throw e;
				}
			}

			// 1) Ensure (or recreate) the venv in global storage (idempotent).
			try {
				await run(uv, plan.venvArgs, venvRoot, { UV_PYTHON_DOWNLOADS: plan.downloads });
			} catch (e: unknown) {
				const message = toMessage(e);
				log(`uv venv failed: ${message}`);
				errorToast(
					vscode.l10n.t(
						'Baochip could not create the uv virtual environment. Often the storage folder is not writable, the disk is full, or antivirus is blocking it. Free space or check permissions, then retry.\n{0}',
						message,
					),
				);
				throw e;
			}

			// 2) Install requirements into that venv
			try {
				await run(uv, ['pip', 'install', '-r', reqPath], venvRoot, {
					UV_PYTHON_DOWNLOADS: 'never',
				});
			} catch (e: unknown) {
				const message = toMessage(e);
				errorToast(
					vscode.l10n.t(
						'Baochip could not install the Python dependencies with uv. Check your network and any proxy or firewall to PyPI, then retry.\n{0}',
						message,
					),
				);
				throw e;
			}

			// 3) Cache the current hash
			await gSet(KEY_REQ_HASH, currentHash);
			log(`requirements hash updated: ${currentHash}`);
		},
	);

	sessionDepsOk = true;
	if (!quiet) info(vscode.l10n.t('Baochip: Python dependencies installed (uv).'));
}

/**
 * Delete everything setup installs under our global storage - the contained uv, the managed Python,
 * uv's download cache, and the venv - so the next setup rebuilds from scratch. A uv the user
 * installed globally themselves is untouched (it lives outside our storage) and is reused on rebuild.
 */
function cleanContainedInstall(): void {
	const root = getGlobalVenvRoot();
	for (const sub of ['uv', 'python', 'cache', '.venv']) {
		const dir = path.join(root, sub);
		try {
			fs.rmSync(dir, { recursive: true, force: true });
			log(`removed ${dir}`);
		} catch (e: unknown) {
			log(`could not remove ${dir}: ${toMessage(e)}`);
		}
	}
}

/**
 * Re-run the automatic environment setup on demand, from a clean slate: remove what we installed
 * (contained uv, managed Python, cache, venv), clear saved state, then reinstall everything. Gated
 * behind a confirmation because it deletes the install and re-downloads over the network.
 */
export async function rerunExtensionSetup(): Promise<void> {
	const proceed = vscode.l10n.t('Reinstall');
	const choice = await vscode.window.showWarningMessage(
		vscode.l10n.t(
			'Re-run setup from scratch? This deletes only the private copies of uv, Python, and the virtual environment that Baochip keeps inside VS Code, then reinstalls them. Any uv or Python installed elsewhere on your system is not affected. A network connection is required.',
		),
		{ modal: true },
		proceed,
	);
	if (choice !== proceed) return;

	sessionUvPath = undefined;
	sessionDepsOk = false;
	await gSet<string | undefined>(KEY_UV_PATH, undefined);
	await gSet<string | undefined>(KEY_UV_PYTHON, undefined);
	await gSet<string | undefined>(KEY_REQ_HASH, undefined);
	cleanContainedInstall();

	await ensureBaoPythonDeps();
	info(vscode.l10n.t('Baochip: extension setup complete.'));
}

export async function resetUvSetup() {
	sessionUvPath = undefined;
	sessionDepsOk = false;
	await gSet<string | undefined>(KEY_UV_PATH, undefined);
	await gSet<string | undefined>(KEY_UV_PYTHON, undefined);
	await gSet<string | undefined>(KEY_REQ_HASH, undefined);
	info(vscode.l10n.t('Baochip: reset uv setup. Re-run a command to reconfigure.'));
	log(`PATH snapshot:\n${process.env.PATH || ''}`);

	// Offer to delete the cached venv too, so "reset and retry" forces a clean rebuild.
	const venvDir = path.join(getGlobalVenvRoot(), '.venv');
	if (fs.existsSync(venvDir)) {
		const deleteLabel = vscode.l10n.t('Delete .venv');
		const choice = await vscode.window.showInformationMessage(
			vscode.l10n.t(
				'Also delete the cached uv virtual environment? It will be rebuilt on the next command.',
			),
			deleteLabel,
		);
		if (choice === deleteLabel) {
			try {
				fs.rmSync(venvDir, { recursive: true, force: true });
				log(`deleted venv: ${venvDir}`);
			} catch (e: unknown) {
				log(`could not delete venv: ${toMessage(e)}`);
			}
		}
	}
}
