import * as path from 'node:path';
import { getAppsDir } from '@constants';
import { setXousCorePath } from '@services/configService';
import { isSameOrParentPath } from '@util/fsUtil';
import * as vscode from 'vscode';

/**
 * Ensure a workspace that *covers* `xousRoot` is open.
 * If a different folder is open, offer:
 *  - Open the configured xous-core
 *  - Update setting to the currently-open workspace
 */
export async function ensureXousWorkspaceOpen(xousRoot: string): Promise<boolean> {
	const folders = vscode.workspace.workspaceFolders || [];

	// Accept if any folder equals or contains xousRoot, or vice-versa.
	for (const f of folders) {
		const cur = f.uri.fsPath;
		if (isSameOrParentPath(cur, xousRoot) || isSameOrParentPath(xousRoot, cur)) {
			// Make sure the setting is saved for this workspace context
			await setXousCorePath(xousRoot);
			return true;
		}
	}

	// At least one folder is open but it's not the configured one.
	if (folders.length > 0) {
		const openPaths = folders.map((f) => f.uri.fsPath).join('\n  - ');
		const choice = await vscode.window.showWarningMessage(
			vscode.l10n.t(
				'The currently open workspace does not match your configured xous-core path.\n\nConfigured xous-core: {0}\nOpen workspace(s):\n  - {1}\n\nChoose what to do:',
				xousRoot,
				openPaths,
			),
			{ modal: true },
			vscode.l10n.t('Open configured xous-core'),
			vscode.l10n.t('Use current workspace instead'),
			vscode.l10n.t('Cancel'),
		);

		if (choice === vscode.l10n.t('Open configured xous-core')) {
			await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(xousRoot), false);
			return false;
		}

		if (choice === vscode.l10n.t('Use current workspace instead')) {
			// Pick the first folder
			const chosen = folders[0].uri.fsPath;
			await setXousCorePath(chosen);
			return true;
		}

		return false;
	}

	const openChoice = await vscode.window.showInformationMessage(
		vscode.l10n.t('xous-core is not open in this workspace. Open "{0}" to continue?', xousRoot),
		{ modal: true },
		vscode.l10n.t('Open'),
	);
	if (openChoice !== vscode.l10n.t('Open')) return false;

	await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(xousRoot), false);
	return false; // window reloads
}

export async function revealAppFolder(xousRoot: string, appName: string, target: string) {
	await vscode.commands.executeCommand('workbench.view.explorer');
	const appDir = path.join(xousRoot, getAppsDir(target), appName);
	try {
		await vscode.commands.executeCommand('workbench.files.action.refreshFilesExplorer');
	} catch {}
	await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(appDir));
}
