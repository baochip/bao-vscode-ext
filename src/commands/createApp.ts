import * as vscode from 'vscode';
import { ensureXousCorePath } from '@services/pathService';
import { ensureXousWorkspaceOpen, revealAppFolder } from '@services/workspaceService';
import { setXousAppName } from '@services/configService';
import { isLikelyValidAppName, createBaoAppViaCli } from '@services/appService';
import { gateToolsBao } from '@services/versionGate';

export function registerCreateApp(_context: vscode.ExtensionContext) {
  return gateToolsBao('baochip.createApp', async () => {
    let root: string;
    try { root = await ensureXousCorePath(); }
    catch (e: any) { vscode.window.showErrorMessage(e?.message || vscode.l10n.t('prereq.xousPathNotSet')); return; }

    const ok = await ensureXousWorkspaceOpen(root);
    if (!ok) return;

    const nameInput = await vscode.window.showInputBox({
      title: vscode.l10n.t('app.create.title'),
      prompt: vscode.l10n.t('app.create.prompt'),
      placeHolder: vscode.l10n.t('app.create.placeholder'),
      validateInput: (val) => {
        const n = (val || '').trim().toLowerCase();
        if (!n) return vscode.l10n.t('app.create.nameRequired');
        if (!isLikelyValidAppName(n)) return vscode.l10n.t('app.create.nameRule');
        return null;
      }
    });
    if (!nameInput) return;

    const name = nameInput.trim().toLowerCase();

    const progressOpts = { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('app.create.progress', name) };
    try {
      await vscode.window.withProgress(progressOpts, async () => {
        await createBaoAppViaCli(root, name);
      });

      await setXousAppName(name);
      vscode.window.showInformationMessage(vscode.l10n.t('app.create.done', name));
      await revealAppFolder(root, name);
    } catch (e: any) {
      vscode.window.showErrorMessage(vscode.l10n.t('app.create.failed', e?.message || String(e)));
    }
  });
}
