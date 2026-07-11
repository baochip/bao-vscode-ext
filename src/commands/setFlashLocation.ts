import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { setFlashLocation } from '@services/configService';
import { confirmBaochipMountedPrompt, promptForFlashFolder } from '@services/flashService';
import * as vscode from 'vscode';

export function registerSetFlashLocation() {
	return withCommand(Commands.setFlashLocation, async () => {
		if (!(await confirmBaochipMountedPrompt())) return;

		const folder = await promptForFlashFolder();
		if (!folder) return;

		await setFlashLocation(folder);
		vscode.window.showInformationMessage(vscode.l10n.t('Baochip location set to: {0}', folder));
	});
}
