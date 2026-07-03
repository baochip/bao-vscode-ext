import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { ensureBuildTargetOrPrompt } from '@services/buildService';
import { getXousAppName } from '@services/configService';
import { decideAndFlash } from '@services/flashService';
import { resolveKernelFiles } from '@services/kernelService';
import { resolveXousRootOrNotify } from '@services/pathService';
import { getOutOfTreeRoot, getProjectMode } from '@services/projectModeService';
import * as vscode from 'vscode';

export function registerFlashCommand() {
	return withCommand(Commands.flash, async () => {
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

		const target = await ensureBuildTargetOrPrompt();
		if (!target) return;

		const app = getXousAppName();
		if (!app) {
			await vscode.window.showWarningMessage(vscode.l10n.t('No app selected.'));
			await vscode.commands.executeCommand(Commands.selectApp);
			return;
		}

		await decideAndFlash(root);
	});
}
