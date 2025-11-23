import { listBaoApps } from '@services/appService';
import { getXousAppName, setXousAppName } from '@services/configService';
import { ensureXousCorePath } from '@services/pathService';
import { ensureXousWorkspaceOpen } from '@services/workspaceService';
import * as vscode from 'vscode';

export function registerSelectApp(_context: vscode.ExtensionContext) {
	return vscode.commands.registerCommand('baochip.selectApp', async () => {
		let root: string;
		try {
			root = await ensureXousCorePath();
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			vscode.window.showErrorMessage(message || vscode.l10n.t('xous-core path not set'));
			return;
		}

		// Enforce opening xous-core as the workspace (2B)
		const ok = await ensureXousWorkspaceOpen(root);
		if (!ok) return;

		const apps = await listBaoApps(root);
		if (apps.length === 0) {
			vscode.window.showWarningMessage(
				vscode.l10n.t('No apps found under {0}. Create one first.', `${root}/apps-bao`),
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
