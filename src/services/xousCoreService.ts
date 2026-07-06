import { XOUS_CORE_REPO } from '@constants';
import { cloneXousCore } from '@services/cloneXousCore';
import { getXousCorePath, setXousCorePath } from '@services/configService';
import { errorToast, log } from '@services/logService';
import { findXousCoreInWorkspace } from '@services/projectModeService';
import { toMessage } from '@util/error';
import { isDirectory, isSameOrParentPath } from '@util/fsUtil';
import * as vscode from 'vscode';

/**
 * If xousCorePath is not yet configured, scan the open workspace for xous-core
 * and save it automatically. Safe to call on activation.
 */
export async function autoDetectXousCore(): Promise<void> {
	const existing = getXousCorePath();
	if (existing && isDirectory(existing)) return; // already configured (a stray FILE does not count)
	const found = findXousCoreInWorkspace();
	if (found) {
		await setXousCorePath(found);
		log(`xous-core auto-detected: ${found}`);
	}
}

export async function ensureXousCorePath(): Promise<string> {
	const p = getXousCorePath();
	if (p && isDirectory(p)) {
		log(`xous-core path (cached): ${p}`);
		return p;
	}

	// Try workspace auto-detection before prompting
	const detected = findXousCoreInWorkspace();
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
		errorToast(message || vscode.l10n.t('xous-core path not set'));
		return undefined;
	}
}

/** Ensure the given `root` is present in the current workspace. */
export async function ensureXousFolderOpen(root: string): Promise<'ready' | 'added' | 'reopen'> {
	const folders = vscode.workspace.workspaceFolders ?? [];
	// Root counts as open if a workspace folder equals it or contains it (or vice-versa).
	const hasRoot = folders.some(
		(f) => isSameOrParentPath(f.uri.fsPath, root) || isSameOrParentPath(root, f.uri.fsPath),
	);
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
