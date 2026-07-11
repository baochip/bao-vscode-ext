import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { getAppsDir } from '@constants';
import { createBaoApp } from '@services/appService';
import { getBuildTargetOrDefault, setXousAppName } from '@services/configService';
import { errorToast } from '@services/logService';
import { scaffoldOutOfTreeApp } from '@services/outOfTreeScaffoldService';
import { getProjectMode } from '@services/projectModeService';
import { ensureXousWorkspaceOpen, revealAppFolder } from '@services/workspaceService';
import { resolveXousRootOrNotify } from '@services/xousCoreService';
import { isLikelyValidAppName } from '@util/appName';
import { toMessage } from '@util/error';
import * as vscode from 'vscode';

export function registerCreateApp() {
	return withCommand(Commands.createApp, async () => {
		if (getBuildTargetOrDefault() === 'baosec') {
			vscode.window.showErrorMessage(vscode.l10n.t('baosec app creation is not yet supported.'));
			return;
		}

		if (getProjectMode() === 'out-of-tree') {
			await scaffoldOutOfTreeApp();
			return;
		}

		const root = await resolveXousRootOrNotify();
		if (!root) return;

		// The user may adopt the currently-open folder here; operate on the returned root, not
		// the configured one they might have just declined.
		const effectiveRoot = await ensureXousWorkspaceOpen(root);
		if (!effectiveRoot) return;

		const target = getBuildTargetOrDefault();
		const appsDir = getAppsDir(target);

		const nameInput = await vscode.window.showInputBox({
			title: vscode.l10n.t('New Baochip App Name'),
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
			title: vscode.l10n.t('Creating app "{0}"...', name),
		};
		try {
			const registered = await vscode.window.withProgress(progressOpts, () =>
				createBaoApp(effectiveRoot, name, target),
			);

			await setXousAppName(name);
			vscode.window.showInformationMessage(
				registered
					? vscode.l10n.t('Created {0}/{1} and added to workspace.', appsDir, name)
					: vscode.l10n.t(
							'Created {0}/{1}. Add it to the workspace members manually.',
							appsDir,
							name,
						),
			);
			await revealAppFolder(effectiveRoot, name, target);
		} catch (e: unknown) {
			const message = toMessage(e);
			errorToast(vscode.l10n.t('Create app failed: {0}', message));
		}
	});
}
