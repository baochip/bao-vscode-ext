import * as fs from 'node:fs';
import * as path from 'node:path';
import { XOUS_CORE_REPO } from '@constants';
import { cloneXousCore } from '@services/cloneXousCore';
import { getXousCorePath, setXousCorePath } from '@services/configService';
import { errorToast, log, warn } from '@services/logService';
import { runProcess } from '@services/procService';
import { findXousCoreInWorkspace } from '@services/projectModeService';
import {
	ensureBaoPythonDeps,
	getBaoRunner,
	getBundledToolsRoot,
	getGlobalVenvRoot,
} from '@services/uvService';
import { toMessage } from '@util/error';
import * as vscode from 'vscode';

/* ------------------------------ utilities ------------------------------ */

function samePath(a: string, b: string) {
	return path.resolve(a) === path.resolve(b);
}

/* ------------------------------ xous-core helpers ------------------------------ */

/** Check each open workspace folder for apps-dabao/ and return the root if found. */
function detectXousCoreInWorkspace(): string | undefined {
	return findXousCoreInWorkspace();
}

/**
 * If xousCorePath is not yet configured, scan the open workspace for xous-core
 * and save it automatically. Safe to call on activation.
 */
export async function autoDetectXousCore(): Promise<void> {
	const existing = getXousCorePath();
	if (existing && fs.existsSync(existing)) return; // already configured
	const found = detectXousCoreInWorkspace();
	if (found) {
		await setXousCorePath(found);
		log(`xous-core auto-detected: ${found}`);
	}
}

export async function ensureXousCorePath(): Promise<string> {
	const p = getXousCorePath();
	if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) {
		log(`xous-core path (cached): ${p}`);
		return p;
	}

	// Try workspace auto-detection before prompting
	const detected = detectXousCoreInWorkspace();
	if (detected) {
		await setXousCorePath(detected);
		log(`xous-core auto-detected: ${detected}`);
		return detected;
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
		await vscode.env.openExternal(vscode.Uri.parse(XOUS_CORE_REPO));
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

/** Resolve the xous-core root; on failure show an error toast and return undefined. */
export async function resolveXousRootOrNotify(): Promise<string | undefined> {
	try {
		return await ensureXousCorePath();
	} catch (e: unknown) {
		const message = toMessage(e);
		vscode.window.showErrorMessage(message || vscode.l10n.t('xous-core path not set'));
		return undefined;
	}
}

/** Return full path to the bundled bao.py inside the installed extension. */
export function resolveBaoPy(): string {
	const p = path.join(getBundledToolsRoot(), 'bao.py');
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
 * Ensures Python deps are installed first and uses global storage as default CWD so uv finds .venv.
 */
export async function runBaoCmd(
	baoArgs: string[],
	cwd?: string,
	opts: { capture?: boolean; quiet?: boolean } = {},
): Promise<string> {
	const { cmd, args } = await getBaoRunner(); // uv + ['run','python']
	const baoPath = resolveBaoPy();

	// Ensure deps before we run anything
	try {
		await ensureBaoPythonDeps({ quiet: true });
	} catch (e: unknown) {
		const message = toMessage(e);
		warn(vscode.l10n.t('Baochip: dependency check failed, proceeding anyway.\n{0}', message));
	}

	const fullArgs = [...args, baoPath, ...baoArgs];

	// Default CWD to global storage so uv discovers .venv there
	const effectiveCwd = cwd ?? getGlobalVenvRoot();

	log(`bao.py INVOKE: ${cmd} ${fullArgs.join(' ')} ${effectiveCwd ? `(cwd=${effectiveCwd})` : ''}`);

	// runProcess captures both streams; we only surface stdout to the caller when capture is requested
	const r = await runProcess(cmd, fullArgs, { cwd: effectiveCwd });
	log(`bao.py EXIT ${r.code}`);
	if (!r.error && r.code === 0) return opts.capture ? r.stdout.trim() : '';
	const msg = (
		r.error ? r.error.message : r.stderr || r.stdout || `bao.py exited ${r.code}`
	).trim();
	if (!opts.quiet) errorToast(vscode.l10n.t('Baochip: bao.py failed.\n{0}', msg));
	throw new Error(msg);
}
