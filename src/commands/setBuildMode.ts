import { withCommand } from '@commands/withCommand';
import { type BuildMode, getBuildMode, setBuildMode } from '@services/configService';
import { getProjectMode } from '@services/projectModeService';
import * as vscode from 'vscode';

export function registerSetBuildMode(refreshUI: () => void) {
	return withCommand('baochip.setBuildMode', async () => {
		const currentSetting = getBuildMode();
		const resolvedMode = getProjectMode();

		const items: (vscode.QuickPickItem & { setting: BuildMode })[] = [
			{
				label:
					currentSetting === 'auto' ? `$(check) ${vscode.l10n.t('auto')}` : vscode.l10n.t('auto'),
				description: vscode.l10n.t('Detect from workspace (currently: {0})', resolvedMode),
				setting: 'auto',
			},
			{
				label: currentSetting === 'xous-core' ? `$(check) xous-core` : 'xous-core',
				description: vscode.l10n.t('Always use xous-core mode'),
				setting: 'xous-core',
			},
			{
				label: currentSetting === 'out-of-tree' ? `$(check) out-of-tree` : 'out-of-tree',
				description: vscode.l10n.t('Always use out-of-tree mode'),
				setting: 'out-of-tree',
			},
		];

		const picked = await vscode.window.showQuickPick(items, {
			title: vscode.l10n.t('Select Build Mode'),
			placeHolder: vscode.l10n.t('Current: {0}', currentSetting),
		});
		if (!picked) return;

		await setBuildMode(picked.setting);
		refreshUI();
	});
}
