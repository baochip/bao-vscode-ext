import { spawnSync } from 'node:child_process';
import { XOUS_TARGET_TRIPLE } from '@constants';
import { installXousToolkit, isXousToolkitInstalled } from '@services/toolkitService';
import { toMessage } from '@util/error';
import * as vscode from 'vscode';

/** verifies that `rustc` and `cargo` exist and report versions.
 *  also warns if riscv32imac-unknown-xous-elf is not installed. */
export async function checkRustToolchain(): Promise<boolean> {
	// 1) rustc
	const rustc = spawnSync('rustc', ['--version'], { encoding: 'utf8' });
	if (rustc.error) {
		await vscode.window.showErrorMessage(
			vscode.l10n.t('Rust not found. Please install Rust from https://rustup.rs before building.'),
		);
		return false;
	}

	// 2) cargo
	const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
	if (cargo.error) {
		await vscode.window.showErrorMessage(
			vscode.l10n.t('Cargo not found. Make sure Rust is installed correctly and in PATH.'),
		);
		return false;
	}

	// 3a) check standard riscv32imac-unknown-none-elf target via rustup (non-fatal)
	const targetCheck = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' });
	const targets = (targetCheck.stdout || '').split(/\r?\n/).map((s) => s.trim());
	if (!targets.includes('riscv32imac-unknown-none-elf')) {
		const installLabel = vscode.l10n.t('Install');
		const choice = await vscode.window.showWarningMessage(
			vscode.l10n.t(
				'The RISC-V target `{0}` is not installed. Install it now?',
				'riscv32imac-unknown-none-elf',
			),
			installLabel,
			vscode.l10n.t('Ignore'),
		);
		if (choice === installLabel) {
			const install = spawnSync('rustup', ['target', 'add', 'riscv32imac-unknown-none-elf'], {
				stdio: 'inherit',
			});
			if (install.status !== 0) {
				vscode.window.showErrorMessage(
					vscode.l10n.t(
						'Failed to install target; please run manually:\n rustup target add riscv32imac-unknown-none-elf',
					),
				);
				return false;
			}
			vscode.window.showInformationMessage(vscode.l10n.t('Target installed successfully.'));
		}
	}

	// 3b) check riscv32imac-unknown-xous-elf - tier-3 target, installed by extracting
	//     a custom toolchain zip from betrusted-io/rust GitHub releases (not via rustup target add)
	if (!isXousToolkitInstalled()) {
		const installLabel = vscode.l10n.t('Install');
		const choice = await vscode.window.showWarningMessage(
			vscode.l10n.t(
				'The RISC-V target `{0}` is not installed. Install it now?',
				XOUS_TARGET_TRIPLE,
			),
			installLabel,
			vscode.l10n.t('Ignore'),
		);
		if (choice === installLabel) {
			try {
				await installXousToolkit();
				vscode.window.showInformationMessage(vscode.l10n.t('Target installed successfully.'));
			} catch (e: unknown) {
				const msg = toMessage(e);
				vscode.window.showErrorMessage(vscode.l10n.t('Failed to install Xous target: {0}', msg));
				return false;
			}
		}
	}

	return true;
}
