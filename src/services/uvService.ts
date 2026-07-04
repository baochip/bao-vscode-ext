import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { chan, errorToast, info, log } from '@services/logService';
import { runProcess } from '@services/procService';
import { toMessage } from '@util/error';
import { isFullPathCommand } from '@util/shell';
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

/** Run a subprocess; concise logs; only surface stdout/stderr on failure. */
async function run(
	cmd: string,
	args: string[],
	cwd?: string,
	extraEnv?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; code: number }> {
	log(`-> ${cmd} ${args.join(' ')}${cwd ? `  (cwd=${cwd})` : ''}`);
	const r = await runProcess(cmd, args, { cwd, env: { ...pythonUtf8Env(), ...extraEnv } });
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

async function pickPython(): Promise<string> {
	const found = detectWorkingPythons();
	if (found.length === 0) {
		const msg = vscode.l10n.t(
			'No working Python interpreters detected on PATH. Please install Python (python.org) and retry.',
		);
		errorToast(msg);
		log(`PATH at failure:\n${process.env.PATH || ''}`);
		throw new Error(msg);
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
	const s = stderr.toLowerCase();
	let hint: string;
	if (s.includes('externally-managed-environment')) {
		hint = vscode.l10n.t(
			'This Python is externally managed (PEP 668), so pip will not install into it. Try a different Python, or install uv with its standalone installer or pipx.',
		);
	} else if (s.includes('no module named pip')) {
		hint = vscode.l10n.t(
			'The selected Python has no pip. Run "python -m ensurepip --upgrade", or pick a different Python.',
		);
	} else if (
		s.includes('certificate_verify_failed') ||
		s.includes('sslerror') ||
		s.includes('ssl:') ||
		s.includes('self-signed certificate')
	) {
		hint = vscode.l10n.t(
			'TLS verification failed, usually a corporate proxy intercepting HTTPS. Ask your IT team for the proxy root certificate and set the SSL_CERT_FILE environment variable, then retry.',
		);
	} else if (
		s.includes('proxyerror') ||
		s.includes('could not fetch') ||
		s.includes('timed out') ||
		s.includes('getaddrinfo') ||
		s.includes('connection')
	) {
		hint = vscode.l10n.t(
			'Could not reach PyPI. Check your network, set HTTP_PROXY/HTTPS_PROXY if you use a proxy, then retry.',
		);
	} else {
		hint = vscode.l10n.t(
			'This usually means no network, a proxy or firewall blocking PyPI, or a broken pip. Check your connection and proxy, then retry.',
		);
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

async function resolveUvBinary(): Promise<string> {
	const saved = gGet<string | undefined>(KEY_UV_PATH, undefined);
	if (saved && uvUsable(saved)) {
		log(`Using saved uv path: ${saved}`);
		return saved;
	}

	const fromPath = whichUvFromPath();
	if (fromPath) {
		await gSet(KEY_UV_PATH, fromPath);
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

			// 1) Ensure (or recreate) the venv in global storage (idempotent). Pin the interpreter to
			// the Python we bootstrapped with (deterministic) and never let uv silently download one.
			try {
				const pyExe = resolvePickedPythonExe();
				const venvArgs = pyExe ? ['venv', '--python', pyExe] : ['venv'];
				await run(uv, venvArgs, venvRoot, { UV_PYTHON_DOWNLOADS: 'never' });
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

	if (!quiet) info(vscode.l10n.t('Baochip: Python dependencies installed (uv).'));
}

export async function resetUvSetup() {
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
