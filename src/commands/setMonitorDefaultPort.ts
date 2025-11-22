import { getMonitorDefaultPort, setMonitorDefaultPort } from '@services/configService';
import { gateToolsBao } from '@services/versionGate';
import * as vscode from 'vscode';

export function registerSetMonitorDefaultPort(
	_context: vscode.ExtensionContext,
	refreshUI: () => void,
) {
	return gateToolsBao('baochip.setMonitorDefaultPort', async () => {
		const current = getMonitorDefaultPort();
		const runLabel = vscode.l10n.t('Run (normal firmware logs)');
		const bootLabel = vscode.l10n.t('Bootloader (drive mode)');

		const picked = await vscode.window.showQuickPick(
			[
				{ label: runLabel, value: 'run' as const },
				{ label: bootLabel, value: 'bootloader' as const },
			],
			{
				placeHolder: vscode.l10n.t(
					'Current: {0}',
					current === 'run' ? vscode.l10n.t('Run') : vscode.l10n.t('Bootloader'),
				),
			},
		);
		if (!picked) return;

		setMonitorDefaultPort(picked.value);
		vscode.window.showInformationMessage(
			vscode.l10n.t('Default monitor port set to: {0}', picked.value),
		);
		refreshUI();
	});
}
