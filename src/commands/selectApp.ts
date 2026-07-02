import { getAppsDir } from '@constants';
import { listBaoApps } from '@services/appService';
import { getBuildTarget, getXousAppName, setXousAppName } from '@services/configService';
import { resolveXousRootOrNotify } from '@services/pathService';
import { getProjectMode } from '@services/projectModeService';
import { ensureXousWorkspaceOpen } from '@services/workspaceService';
import * as vscode from 'vscode';

export function registerSelectApp(_context: vscode.ExtensionContext) {
	return vscode.commands.registerCommand('baochip.selectApp', async () => {
		if (getProjectMode() === 'out-of-tree') return;

		const root = await resolveXousRootOrNotify();
		if (!root) return;

		// Enforce opening xous-core as the workspace (2B)
		const ok = await ensureXousWorkspaceOpen(root);
		if (!ok) return;

		const target = getBuildTarget() || 'dabao';
		const apps = await listBaoApps(root, target);
		if (apps.length === 0) {
			vscode.window.showWarningMessage(
				vscode.l10n.t(
					'No apps found under {0}. Create one first.',
					`${root}/${getAppsDir(target)}`,
				),
			);
			return;
		}

		const current = getXousAppName();
		const pick = await vscode.window.showQuickPick(
			apps.map((a) => ({
				label: a,
				description: a === current ? vscode.l10n.t('current') : undefined,
			})),
			{ placeHolder: vscode.l10n.t('Select app') },
		);
		if (!pick) return;

		await setXousAppName(pick.label);
		vscode.window.showInformationMessage(vscode.l10n.t('Bao app set to {0}', pick.label));
	});
}
