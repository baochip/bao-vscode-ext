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
    catch (e: any) { vscode.window.showErrorMessage(e?.message || vscode.l10n.t('xous-core path not set')); return; }

    const ok = await ensureXousWorkspaceOpen(root);
    if (!ok) return;

    const nameInput = await vscode.window.showInputBox({
      title: vscode.l10n.t('New Bao App Name'),
      prompt: vscode.l10n.t('Will be created under xous-core/apps-dabao/<name>/'),
      placeHolder: vscode.l10n.t('test_app'),
      validateInput: (val) => {
        const n = (val || '').trim().toLowerCase();
        if (!n) return vscode.l10n.t('App name is required');
        if (!isLikelyValidAppName(n)) return vscode.l10n.t('Use lowercase letters, numbers, -, _; start with a letter');
        return null;
      }
    });
    if (!nameInput) return;

    const name = nameInput.trim().toLowerCase();

    const progressOpts = { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Creating app "{0}"…', name) };
    try {
      await vscode.window.withProgress(progressOpts, async () => {
        await createBaoAppViaCli(root, name);
      });

      await setXousAppName(name);
      vscode.window.showInformationMessage(vscode.l10n.t('Created apps-dabao/{0} and added to workspace.', name));
      await revealAppFolder(root, name);
    } catch (e: any) {
      vscode.window.showErrorMessage(vscode.l10n.t('Create app failed: {0}', e?.message || String(e)));
    }
  });
}
