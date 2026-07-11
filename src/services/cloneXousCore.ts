import * as path from 'node:path';
import { XOUS_CORE_REPO } from '@constants';
import { isDirectory } from '@util/fsUtil';
import * as vscode from 'vscode';

export async function cloneXousCore(): Promise<string | undefined> {
	// Ask where to put it
	const destUris = await vscode.window.showOpenDialog({
		title: vscode.l10n.t('Choose a folder to clone xous-core into'),
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: vscode.l10n.t('Clone here'),
	});
	if (!destUris || destUris.length === 0) return;

	const destFsPath = destUris[0].fsPath; // <-- string path, not Uri

	// Only the built-in Git extension provides git.clone. If it is not available, open the repo in
	// the browser. A clone that is cancelled or fails (handled below) is distinct from that - it
	// must not open the browser or claim the extension is missing.
	const hasGitClone = (await vscode.commands.getCommands(true)).includes('git.clone');
	if (!hasGitClone) {
		await vscode.env.openExternal(vscode.Uri.parse(XOUS_CORE_REPO));
		vscode.window.showWarningMessage(
			vscode.l10n.t(
				'Opening repo in browser. After cloning locally, select the folder in settings.',
			),
		);
		return;
	}

	try {
		await vscode.commands.executeCommand('git.clone', XOUS_CORE_REPO, destFsPath);
	} catch (_e) {
		// git.clone exists but the clone did not complete (cancelled, network/auth failure, ...).
		// Return undefined; the caller surfaces "Clone did not complete."
		return;
	}

	// Common case: git creates "<chosen folder>/xous-core"
	const guess = path.join(destFsPath, 'xous-core');
	if (isDirectory(guess)) {
		return guess;
	}

	// If user renamed the folder during clone, prompt them to pick the cloned folder
	const picked = await vscode.window.showOpenDialog({
		title: vscode.l10n.t('Select your cloned xous-core folder'),
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: vscode.l10n.t('Use this folder'),
	});
	return picked?.[0]?.fsPath;
}
