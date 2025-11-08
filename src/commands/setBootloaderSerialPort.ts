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
      vscode.window.showWarningMessage(e?.message || vscode.l10n.t('prereq.xousPathNotSet'));
      return;
    }

    const lines = await runBaoCmd(['ports'], cwd, { capture: true }).catch(err => {
      vscode.window.showErrorMessage(vscode.l10n.t('ports.listFailed', err?.message || String(err)));
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
      vscode.window.showWarningMessage(vscode.l10n.t('ports.noneFound'));
      return;
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: vscode.l10n.t('ports.selectBootloaderPort')
    });
    if (!picked) return;

    await saveBootPort(picked.label); // store only the bare port
    vscode.window.showInformationMessage(vscode.l10n.t('ports.bootloaderSet', picked.label));
    try { refreshUI(); } catch {}
  });
}
