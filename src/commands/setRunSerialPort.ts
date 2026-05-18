import { setRunSerialPort as saveRunPort } from '@services/configService';
import { runBaoCmd } from '@services/pathService';
import { pickSerialPort } from '@services/portsService';
import { getGlobalVenvRoot } from '@services/uvService';
import * as vscode from 'vscode';

export function registerSetRunSerialPort(_context: vscode.ExtensionContext, refreshUI: () => void) {
	return vscode.commands.registerCommand('baochip.setRunSerialPort', async () => {
		const port = await pickSerialPort(runBaoCmd, getGlobalVenvRoot(), {
			confirmTitle: vscode.l10n.t('Is your Baochip board in run mode?'),
			confirmDetail: vscode.l10n.t(
				'If you still see a removable drive named "BAOCHIP",\npress PROG on the board to enter run mode.',
			),
			placeholder: vscode.l10n.t('Select run mode (firmware) serial port'),
		});
		if (!port) return;

		await saveRunPort(port); // store only the bare port (e.g., "COM7")
		vscode.window.showInformationMessage(vscode.l10n.t('Run mode serial port set to: {0}', port));
		try {
			refreshUI();
		} catch {}
	});
}
