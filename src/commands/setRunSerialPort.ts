import * as vscode from 'vscode';
import { ensureXousCorePath, runBaoCmd } from '@services/pathService';
import { setRunSerialPort as saveRunPort } from '@services/configService';
import { gateToolsBao } from '@services/versionGate';

export function registerSetRunSerialPort(context: vscode.ExtensionContext, refreshUI: () => void) {
  return gateToolsBao('baochip.setRunSerialPort', async () => {
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
      placeHolder: vscode.l10n.t('ports.selectRunPort'),
    });
    if (!picked) return;

    await saveRunPort(picked.label); // store only the bare port (e.g., "COM7")
    vscode.window.showInformationMessage(vscode.l10n.t('ports.runSet', picked.label));
    try { refreshUI(); } catch {}
  });
}
