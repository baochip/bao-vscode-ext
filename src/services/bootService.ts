import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { getDefaultBaud, getBootloaderSerialPort } from '@services/configService';
import { getBaoRunner } from '@services/pathService';

const q = (s: string) => (/\s|["`]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

export async function sendBoot(
  _runBao: (args: string[], cwd?: string, opts?: { capture?: boolean }) => Promise<string>,
  bao: string,
  root: string
): Promise<boolean> {
  // Ensure bootloader port is set; if not, prompt and re-check.
  let port = getBootloaderSerialPort();
  if (!port) {
    vscode.window.showInformationMessage(vscode.l10n.t('No {0} serial port set. Pick one first.', vscode.l10n.t('bootloader mode')));
    await vscode.commands.executeCommand('baochip.setBootloaderSerialPort');

    // Re-check after the command returns.
    port = getBootloaderSerialPort();
    if (!port) {
      vscode.window.showWarningMessage('Bootloader mode serial port is still not set. Aborting boot.');
      return false;
    }
  }

  const baud = getDefaultBaud();
  const chan = vscode.window.createOutputChannel(vscode.l10n.t('Bao Boot'));
  chan.show(true);
  chan.appendLine(`[bao] ${vscode.l10n.t('Sending \'boot\' to {0} @ {1}…', port, baud)}`);

  const { cmd, args } = await getBaoRunner(); // e.g., uv + ['run','python']
  const fullArgs = [...args, bao, 'boot', '-p', port, '-b', String(baud)];

  return new Promise<boolean>((resolve) => {
    const child = spawn(cmd, fullArgs, { cwd: root, shell: process.platform === 'win32' });

    let out = '', err = '';
    child.stdout.on('data', d => { const s = d.toString(); out += s; chan.append(s); });
    child.stderr.on('data', d => { const s = d.toString(); err += s; chan.append(s); });
    child.on('close', code => {
      if (code === 0) {
        chan.appendLine(`[bao] ${vscode.l10n.t('boot command succeeded.')}`);
        resolve(true);
      } else {
        const msg = (err || out || `exit ${code}`).trim().slice(0, 300);
        vscode.window.showErrorMessage(vscode.l10n.t('Boot command failed: {0}', msg));
        chan.appendLine(`[bao] ${vscode.l10n.t('Boot command failed: {0}', msg)}`);
        resolve(false);
      }
    });
  });
}
