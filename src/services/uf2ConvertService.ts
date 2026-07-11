import * as fs from 'node:fs';
import * as path from 'node:path';
import { XOUS_TARGET_TRIPLE } from '@constants';
import { appendSeparator, getBaochipChannel } from '@services/logService';
import { runProcess } from '@services/procService';
import { readCargoPackageName } from '@util/cargo';
import * as vscode from 'vscode';

export async function convertElfToUf2(root: string): Promise<boolean> {
	const pkgName = readCargoPackageName(root);
	if (!pkgName) {
		vscode.window.showErrorMessage(vscode.l10n.t('Could not read package name from Cargo.toml.'));
		return false;
	}

	const elfPath = path.join(root, 'target', XOUS_TARGET_TRIPLE, 'release', pkgName);
	if (!fs.existsSync(elfPath)) {
		vscode.window.showErrorMessage(
			vscode.l10n.t('ELF not found at {0}. Has the build completed successfully?', elfPath),
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
			const r = await runProcess('xous-app-uf2', ['--elf', elfPath], {
				cwd: root,
				onStdout: (s) => chan.append(s),
				onStderr: (s) => chan.append(s),
			});
			if (!r.error && r.code === 0) return true;
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
