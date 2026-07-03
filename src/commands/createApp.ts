import { getAppsDir } from '@constants';
import { createBaoApp } from '@services/appService';
import { getBuildTarget, setXousAppName } from '@services/configService';
import { scaffoldOutOfTreeApp } from '@services/outOfTreeScaffoldService';
import { resolveXousRootOrNotify } from '@services/pathService';
import { getProjectMode } from '@services/projectModeService';
import { ensureXousWorkspaceOpen, revealAppFolder } from '@services/workspaceService';
import { isLikelyValidAppName } from '@util/appName';
import { toMessage } from '@util/error';
import * as vscode from 'vscode';

export function registerCreateApp(_context: vscode.ExtensionContext) {
	return vscode.commands.registerCommand('baochip.createApp', async () => {
		if ((getBuildTarget() || 'dabao') === 'baosec') {
			vscode.window.showErrorMessage(vscode.l10n.t('baosec app creation is not yet supported.'));
			return;
		}

		if (getProjectMode() === 'out-of-tree') {
			await scaffoldOutOfTreeApp();
			return;
		}

		const root = await resolveXousRootOrNotify();
		if (!root) return;

		const ok = await ensureXousWorkspaceOpen(root);
		if (!ok) return;

		const target = getBuildTarget() || 'dabao';
		const appsDir = getAppsDir(target);

		const nameInput = await vscode.window.showInputBox({
			title: vscode.l10n.t('New Bao App Name'),
			prompt: vscode.l10n.t('Will be created under xous-core/{0}/<name>/', appsDir),
			placeHolder: vscode.l10n.t('test_app'),
			validateInput: (val) => {
				const n = (val || '').trim().toLowerCase();
				if (!n) return vscode.l10n.t('App name is required');
				if (!isLikelyValidAppName(n))
					return vscode.l10n.t('Use lowercase letters, numbers, -, _; start with a letter');
				return null;
			},
		});
		if (!nameInput) return;

		const name = nameInput.trim().toLowerCase();

		const progressOpts = {
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Creating app "{0}"…', name),
		};
		try {
			await vscode.window.withProgress(progressOpts, async () => {
				await createBaoApp(root, name, target);
			});

			await setXousAppName(name);
			vscode.window.showInformationMessage(
				vscode.l10n.t('Created {0}/{1} and added to workspace.', appsDir, name),
			);
			await revealAppFolder(root, name, target);
		} catch (e: unknown) {
			const message = toMessage(e);
			vscode.window.showErrorMessage(vscode.l10n.t('Create app failed: {0}', message));
		}
	});
}
