import { getBuildTarget, getXousAppName } from '@services/configService';
import { decideAndFlash } from '@services/flashService';
import { ensureXousCorePath, resolveBaoPy } from '@services/pathService';
import { gateToolsBao } from '@services/versionGate';
import * as vscode from 'vscode';

export function registerFlashCommand(_context: vscode.ExtensionContext) {
	return gateToolsBao('baochip.flash', async () => {
		let root: string;
		let _bao: string;
		try {
			root = await ensureXousCorePath();
			_bao = await resolveBaoPy();
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			vscode.window.showErrorMessage(message || vscode.l10n.t('xous-core / bao.py not set'));
			return;
		}

		const target = getBuildTarget();
		if (!target) {
			const a = await vscode.window.showWarningMessage(
				vscode.l10n.t('No build target set.'),
				vscode.l10n.t('Select Target'),
			);
			if (a === vscode.l10n.t('Select Target')) {
				await vscode.commands.executeCommand('baochip.selectBuildTarget');
			}
			return;
		}

		const app = getXousAppName();
		if (!app) {
			await vscode.window.showWarningMessage(vscode.l10n.t('No app selected.'));
			await vscode.commands.executeCommand('baochip.selectApp');
			return;
		}

		await decideAndFlash(root);
	});
}
