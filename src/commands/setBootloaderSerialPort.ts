import { setBootloaderSerialPort as saveBootPort } from '@services/configService';
import { runBaoCmd } from '@services/pathService';
import { pickSerialPort } from '@services/portsService';
import { getGlobalVenvRoot } from '@services/uvService';
import * as vscode from 'vscode';

export function registerSetBootloaderSerialPort(
	_context: vscode.ExtensionContext,
	refreshUI: () => void,
) {
	return vscode.commands.registerCommand('baochip.setBootloaderSerialPort', async () => {
		const port = await pickSerialPort(runBaoCmd, getGlobalVenvRoot(), {
			confirmTitle: vscode.l10n.t('Is your Baochip board in bootloader mode?'),
			confirmDetail: vscode.l10n.t(
				'Press RESET on the board if you do not\nsee a removable drive named "BAOCHIP".',
			),
			placeholder: vscode.l10n.t('Select bootloader (drive mode) serial port'),
		});
		if (!port) return;

		await saveBootPort(port); // store only the bare port
		vscode.window.showInformationMessage(
			vscode.l10n.t('Bootloader (drive mode) serial port set to: {0}', port),
		);
		try {
			refreshUI();
		} catch {}
	});
}
