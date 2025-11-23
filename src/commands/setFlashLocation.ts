import { setFlashLocation } from '@services/configService';
import * as vscode from 'vscode';

export function registerSetFlashLocation(_context: vscode.ExtensionContext, refreshUI: () => void) {
	return vscode.commands.registerCommand('baochip.setFlashLocation', async () => {
		const selectFolderBtn = vscode.l10n.t('Select Folder');
		const ok = await vscode.window.showInformationMessage(
			vscode.l10n.t(
				'You need to select the drive where your baochip is mounted.\n\n1) Make sure your baochip is plugged in.\n2) If you cannot see the BAOCHIP drive on your computer, press the RESET button and wait for the drive to appear.',
			),
			{ modal: true },
			selectFolderBtn,
		);
		if (ok !== selectFolderBtn) {
			throw new Error(vscode.l10n.t('baochip location not set'));
		}

		const pick = await vscode.window.showOpenDialog({
			title: vscode.l10n.t('Select mounted baochip drive'),
			canSelectFiles: false,
			canSelectFolders: true,
			canSelectMany: false,
			openLabel: vscode.l10n.t('Use this location'),
		});

		if (!pick || pick.length === 0) return;
		const folder = pick[0].fsPath;

		await setFlashLocation(folder);
		vscode.window.showInformationMessage(vscode.l10n.t('Baochip location set to: {0}', folder));
		refreshUI();
	});
}
