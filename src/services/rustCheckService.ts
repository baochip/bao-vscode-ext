import * as vscode from 'vscode';
import { spawnSync } from 'child_process';

/** verifies that `rustc` and `cargo` exist and report versions.
 *  also warns if riscv32imac-unknown-xous-elf is not installed. */
export async function checkRustToolchain(): Promise<boolean> {
  // 1) rustc
  const rustc = spawnSync('rustc', ['--version'], { encoding: 'utf8' });
  if (rustc.error) {
    await vscode.window.showErrorMessage(
      'Rust not found. Please install Rust from https://rustup.rs before building.'
    );
    return false;
  }

  // 2) cargo
  const cargo = spawnSync('cargo', ['--version'], { encoding: 'utf8' });
  if (cargo.error) {
    await vscode.window.showErrorMessage(
      'Cargo not found. Make sure Rust is installed correctly and in PATH.'
    );
    return false;
  }

  // 3) check riscv target (non-fatal)
  const targetCheck = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' });
  const targets = (targetCheck.stdout || '').split(/\r?\n/).map(s => s.trim());
  if (!targets.includes('riscv32imac-unknown-none-elf')) {
    const choice = await vscode.window.showWarningMessage(
      'The RISC-V target `riscv32imac-unknown-none-elf` is not installed. Install it now?',
      'Install', 'Ignore'
    );
    if (choice === 'Install') {
      const install = spawnSync('rustup', ['target', 'add', 'riscv32imac-unknown-none-elf'], { stdio: 'inherit' });
      if (install.status !== 0) {
        vscode.window.showErrorMessage('Failed to install target; please run manually:\n rustup target add riscv32imac-unknown-none-elf');
        return false;
      }
      vscode.window.showInformationMessage('Target installed successfully.');
    }
  }

  return true;
}
