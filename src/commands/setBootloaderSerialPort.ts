import * as vscode from 'vscode';
import { ensureXousCorePath, runBaoCmd } from '@services/pathService';
import { setBootloaderSerialPort as saveBootPort } from '@services/configService';
import { gateToolsBao } from '@services/versionGate';

export function registerSetBootloaderSerialPort(context: vscode.ExtensionContext, refreshUI: () => void) {
  return gateToolsBao('baochip.setBootloaderSerialPort', async () => {
    let cwd: string;
    try {
      cwd = await ensureXousCorePath();
    } catch (e: any) {
      vscode.window.showWarningMessage(e?.message || vscode.l10n.t('xous-core path not set'));
      return;
    }

    const clicked = await vscode.window.showInformationMessage(
      'Is your Baochip board in bootloader mode?',
      {
        modal: true,
        detail:
          'Press RESET on the board if you do not\n' +
          'see a removable drive named "BAOCHIP".',
      },
      'OK'
    );
    if (clicked !== 'OK') return;

    const lines = await runBaoCmd(['ports'], cwd, { capture: true }).catch(err => {
      vscode.window.showErrorMessage(vscode.l10n.t('Could not list ports: {0}', err?.message || String(err)));
      return '' as string;
    });

    const items = (lines || '')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(line => {
        const [port, desc] = line.split('\t');
        return { label: port, description: desc || undefined };
      });

    if (items.length === 0) {
      vscode.window.showWarningMessage(vscode.l10n.t('No serial ports found.'));
      return;
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: vscode.l10n.t('Select bootloader (drive mode) serial port')
    });
    if (!picked) return;

    await saveBootPort(picked.label); // store only the bare port
    vscode.window.showInformationMessage(vscode.l10n.t('Bootloader (drive mode) serial port set to: {0}', picked.label));
    try { refreshUI(); } catch {}
  });
}
