import { spawnSync } from 'node:child_process';
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

	// 3) check riscv target (non-fatal)
	const targetCheck = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' });
	const targets = (targetCheck.stdout || '').split(/\r?\n/).map((s) => s.trim());
	if (!targets.includes('riscv32imac-unknown-none-elf')) {
		const choice = await vscode.window.showWarningMessage(
			vscode.l10n.t(
				'The RISC-V target `{0}` is not installed. Install it now?',
				'riscv32imac-unknown-none-elf',
			),
			vscode.l10n.t('Install'),
			vscode.l10n.t('Ignore'),
		);
		if (choice === vscode.l10n.t('Install')) {
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

	return true;
}
