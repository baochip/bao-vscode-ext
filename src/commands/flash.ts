import { getBuildTarget, getXousAppName } from '@services/configService';
import { decideAndFlash } from '@services/flashService';
import { resolveKernelFiles } from '@services/kernelService';
import { resolveXousRootOrNotify } from '@services/pathService';
import { getOutOfTreeRoot, getProjectMode } from '@services/projectModeService';
import * as vscode from 'vscode';

export function registerFlashCommand(_context: vscode.ExtensionContext) {
	return vscode.commands.registerCommand('baochip.flash', async () => {
		if (getProjectMode() === 'out-of-tree') {
			const root = getOutOfTreeRoot();
			if (!root) return;
			const kernelFiles = await resolveKernelFiles();
			if (!kernelFiles) return;
			await decideAndFlash(root, kernelFiles);
			return;
		}

		const root = await resolveXousRootOrNotify();
		if (!root) return;

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
