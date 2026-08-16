import * as fs from 'node:fs';
import * as path from 'node:path';
import { XOUS_TARGET_TRIPLE } from '@constants';
import { checkUf2Size } from '@services/flashService';
import { appendSeparator, getBaochipChannel } from '@services/logService';
import { runProcess } from '@services/procService';
import * as vscode from 'vscode';

export async function convertElfToUf2(root: string, crates: string[]): Promise<boolean> {
	const elfPaths = crates.map((crate) =>
		path.join(root, 'target', XOUS_TARGET_TRIPLE, 'release', crate),
	);
	const missing = elfPaths.filter((elf) => !fs.existsSync(elf));
	if (missing.length > 0) {
		vscode.window.showErrorMessage(
			vscode.l10n.t(
				'ELF not found at {0}. Has the build completed successfully?',
				missing.join(', '),
			),
		);
		return false;
	}

	const chan = getBaochipChannel();
	appendSeparator(chan, 'UF2 Convert');
	chan.appendLine(`[bao] ${vscode.l10n.t('Baochip: Converting ELF to UF2...')}`);
	chan.show(true);

	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Converting ELF to UF2...'),
			cancellable: false,
		},
		async () => {
			const r = await runProcess(
				'xous-app-uf2',
				elfPaths.flatMap((elf) => ['--elf', elf]),
				{
					cwd: root,
					onStdout: (s) => chan.append(s),
					onStderr: (s) => chan.append(s),
				},
			);
			if (!r.error && r.code === 0) {
				checkUf2Size(path.join(root, 'apps.uf2'));
				return true;
			}
			if (r.error) {
				// A spawn failure (e.g. xous-app-uf2 not on PATH) never streams to the channel, so the
				// "See output" toast would point at an empty channel; record the reason here.
				chan.appendLine(
					`[bao] ${vscode.l10n.t('{0} failed to start: {1}', 'xous-app-uf2', r.error.message)}`,
				);
			}
			vscode.window.showErrorMessage(
				vscode.l10n.t('Baochip: ELF to UF2 conversion failed. See output for details.'),
			);
			return false;
		},
	);
}
