import { getDefaultBaud, setDefaultBaud } from '@services/configService';
import * as vscode from 'vscode';

export function registerSetMonitorBaud(_context: vscode.ExtensionContext) {
	return vscode.commands.registerCommand('baochip.setMonitorBaud', async () => {
		const current = getDefaultBaud();
		const input = await vscode.window.showInputBox({
			title: vscode.l10n.t('Set monitor baud rate'),
			value: String(current),
			ignoreFocusOut: true,
			validateInput: (v) => {
				const n = Number(v);
				return Number.isInteger(n) && n > 0 ? null : vscode.l10n.t('Enter a positive integer');
			},
		});
		if (input === undefined) return;
		await setDefaultBaud(Number(input));
	});
}
