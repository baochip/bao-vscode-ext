import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { getDefaultBaud, getBootloaderSerialPort } from '@services/configService';

const q = (s: string) => (/\s|["`]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

export async function sendBoot(py: string, bao: string, root: string): Promise<boolean> {
  const port = getBootloaderSerialPort();
  if (!port) {
    vscode.window.showWarningMessage('Bootloader-mode serial port not set. Set it first.');
    await vscode.commands.executeCommand('baochip.setBootloaderSerialPort');
    return false;
  }

  const baud = getDefaultBaud();
  const chan = vscode.window.createOutputChannel('Bao Boot');
  chan.show(true);
  chan.appendLine(`[bao] Sending 'boot' to ${port} @ ${baud}…`);

  return new Promise<boolean>((resolve) => {
    const args = [bao, 'boot', '-p', port, '-b', String(baud)];
    const child = spawn(py, args, { cwd: root, shell: process.platform === 'win32' });

    let out = '', err = '';
    child.stdout.on('data', d => { const s = d.toString(); out += s; chan.append(s); });
    child.stderr.on('data', d => { const s = d.toString(); err += s; chan.append(s); });
    child.on('close', code => {
      if (code === 0) {
        chan.appendLine('[bao] boot command succeeded.');
        resolve(true);
      } else {
        const msg = (err || out || `exit ${code}`).trim().slice(0, 300);
        vscode.window.showErrorMessage(`Boot command failed: ${msg}`);
        resolve(false);
      }
    });
  });
}
