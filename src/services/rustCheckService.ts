import { XOUS_TARGET_TRIPLE } from '@constants';
import { errorToast, getChannel } from '@services/logService';
import { runProcess } from '@services/procService';
import { installXousToolkit, isXousToolkitInstalled } from '@services/toolkitService';
import { toMessage } from '@util/error';
import * as vscode from 'vscode';

/** verifies that `rustc` and `cargo` exist and report versions.
 *  also warns if riscv32imac-unknown-xous-elf is not installed. */
export async function checkRustToolchain(): Promise<boolean> {
	// 1) rustc
	const rustc = await runProcess('rustc', ['--version']);
	if (rustc.error) {
		await vscode.window.showErrorMessage(
			vscode.l10n.t('Rust not found. Please install Rust from https://rustup.rs before building.'),
		);
		return false;
	}

	// 2) cargo
	const cargo = await runProcess('cargo', ['--version']);
	if (cargo.error) {
		await vscode.window.showErrorMessage(
			vscode.l10n.t('Cargo not found. Make sure Rust is installed correctly and in PATH.'),
		);
		return false;
	}

	// 3a) check standard riscv32imac-unknown-none-elf target via rustup (non-fatal)
	const targetCheck = await runProcess('rustup', ['target', 'list', '--installed']);
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
			// Async with output streamed to the channel: the download takes tens of seconds and a
			// synchronous spawn would freeze the extension host (with the output invisible).
			const chan = getChannel(vscode.l10n.t('Bao Build'));
			chan.show(true);
			const install = await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: vscode.l10n.t('Baochip: Installing RISC-V target...'),
					cancellable: false,
				},
				() =>
					runProcess('rustup', ['target', 'add', 'riscv32imac-unknown-none-elf'], {
						onStdout: (s) => chan.append(s),
						onStderr: (s) => chan.append(s),
					}),
			);
			if (install.error || install.code !== 0) {
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
	if (!(await isXousToolkitInstalled())) {
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
				errorToast(vscode.l10n.t('Failed to install Xous target: {0}', msg));
				return false;
			}
		}
	}

	return true;
}
