import { spawnSync } from 'node:child_process';
import { chan } from '@services/logService';
import { runProcess } from '@services/procService';
import * as vscode from 'vscode';

export function isXousAppUf2Available(): boolean {
	const r = spawnSync('xous-app-uf2', ['--version'], { encoding: 'utf8', shell: true });
	return !r.error && r.status === 0;
}

export async function checkXousAppUf2(): Promise<boolean> {
	if (isXousAppUf2Available()) return true;

	const installLabel = vscode.l10n.t('Install');
	const choice = await vscode.window.showWarningMessage(
		vscode.l10n.t('xous-app-uf2 not found. Install xous-tools to enable out-of-tree builds.'),
		installLabel,
		vscode.l10n.t('Cancel'),
	);
	if (choice !== installLabel) return false;

	chan.clear();
	chan.show(true);

	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Installing xous-tools…'),
			cancellable: false,
		},
		async () => {
			const r = await runProcess('cargo', ['install', 'xous-tools'], {
				onStdout: (s) => chan.append(s),
				onStderr: (s) => chan.append(s),
			});
			if (!r.error && r.code === 0) {
				vscode.window.showInformationMessage(
					vscode.l10n.t('Baochip: xous-tools installed successfully.'),
				);
				return true;
			}
			vscode.window.showErrorMessage(
				vscode.l10n.t('Baochip: Failed to install xous-tools. See output for details.'),
			);
			return false;
		},
	);
}
