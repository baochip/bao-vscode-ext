import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cloneXousCore } from '@services/cloneXousCore';
import { setXousCorePath } from '@services/configService';
import { errorToast, log, warn } from '@services/logService';
import { ensureBaoPythonDeps, getBaoRunner } from '@services/uvService';
import * as vscode from 'vscode';

/* ------------------------------ utilities ------------------------------ */

function samePath(a: string, b: string) {
	return path.resolve(a) === path.resolve(b);
}

/* ------------------------------ xous-core helpers ------------------------------ */

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

/* ------------------------------ bao runner ------------------------------ */

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
		warn(vscode.l10n.t('Baochip: dependency check failed, proceeding anyway.\n{0}', message));
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
			errorToast(vscode.l10n.t('Baochip: bao.py failed.\n{0}', msg));
			reject(new Error(msg));
		});
	});
}
