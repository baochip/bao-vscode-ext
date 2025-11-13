import * as vscode from 'vscode';
import { ensureXousCorePath, resolveBaoPy, runBaoCmd } from '@services/pathService';
import { getBuildTarget, getXousAppName } from '@services/configService';
import { decideAndFlash } from '@services/flashService';
import { gateToolsBao } from '@services/versionGate';

export function registerFlashCommand(context: vscode.ExtensionContext) {
  return gateToolsBao('baochip.flash', async () => {
    let root: string, bao: string;
    try { root = await ensureXousCorePath(); bao = await resolveBaoPy(); }
    catch (e: any) { vscode.window.showErrorMessage(e?.message || vscode.l10n.t('xous-core / bao.py not set')); return; }

    const target = getBuildTarget();
    if (!target) {
      const a = await vscode.window.showWarningMessage(vscode.l10n.t('No build target set.'), vscode.l10n.t('Select Target'));
      if (a === vscode.l10n.t('Select Target')) {
        await vscode.commands.executeCommand('baochip.selectBuildTarget');
      }
      return;
    }

    const app = getXousAppName();
    if (!app) {
      await vscode.window.showWarningMessage(vscode.l10n.t('No app selected.'));
      await vscode.commands.executeCommand('baochip.selectApp');
      return;
    }

    await decideAndFlash(root);
  });
}
