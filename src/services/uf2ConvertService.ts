import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { XOUS_TARGET_TRIPLE } from '@constants';
import { chan } from '@services/logService';
import { parseCargoPackageName } from '@util/cargo';
import * as vscode from 'vscode';

function readPackageName(root: string): string | null {
	try {
		const content = fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8');
		return parseCargoPackageName(content);
	} catch {
		return null;
	}
}

export async function convertElfToUf2(root: string): Promise<boolean> {
	const pkgName = readPackageName(root);
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

	chan.appendLine(`[bao] ${vscode.l10n.t('Baochip: Converting ELF to UF2…')}`);
	chan.show(true);

	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Converting ELF to UF2…'),
			cancellable: false,
		},
		() =>
			new Promise<boolean>((resolve) => {
				const child = spawn('xous-app-uf2', ['--elf', elfPath], {
					cwd: root,
					shell: os.platform() === 'win32',
				});

				child.stdout.on('data', (d) => chan.append(d.toString()));
				child.stderr.on('data', (d) => chan.append(d.toString()));
				child.on('close', (code) => {
					if (code === 0) {
						resolve(true);
					} else {
						vscode.window.showErrorMessage(
							vscode.l10n.t('Baochip: ELF to UF2 conversion failed. See output for details.'),
						);
						resolve(false);
					}
				});
			}),
	);
}
