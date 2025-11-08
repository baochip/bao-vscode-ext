import * as vscode from 'vscode';
import { spawnSync } from 'child_process';

/** verifies that `rustc` and `cargo` exist and report versions.
 *  also warns if riscv32imac-unknown-xous-elf is not installed. */
export async function checkRustToolchain(): Promise<boolean> {
  // 1) rustc
  const rustc = spawnSync('rustc', ['--version'], { encoding: 'utf8' });
  if (rustc.error) {
    await vscode.window.showErrorMessage(
      vscode.l10n.t('rust.missingRust')
    );
    return false;
  }

  // 2) cargo
  const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
  if (cargo.error) {
    await vscode.window.showErrorMessage(
      vscode.l10n.t('rust.missingCargo')
    );
    return false;
  }

  // 3) check riscv target (non-fatal)
  const targetCheck = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' });
  const targets = (targetCheck.stdout || '').split(/\r?\n/).map(s => s.trim());
  if (!targets.includes('riscv32imac-unknown-none-elf')) {
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('rust.targetMissingPrompt', 'riscv32imac-unknown-none-elf'),
      vscode.l10n.t('button.install'),
      vscode.l10n.t('button.ignore')
    );
    if (choice === vscode.l10n.t('button.install')) {
      const install = spawnSync('rustup', ['target', 'add', 'riscv32imac-unknown-none-elf'], { stdio: 'inherit' });
      if (install.status !== 0) {
        vscode.window.showErrorMessage(vscode.l10n.t('rust.targetInstallFailed'));
        return false;
      }
      vscode.window.showInformationMessage(vscode.l10n.t('rust.targetInstallSuccess'));
    }
  }

  return true;
}
