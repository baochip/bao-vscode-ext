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
    catch (e: any) { vscode.window.showErrorMessage(e?.message || 'xous-core path not set'); return; }

    const ok = await ensureXousWorkspaceOpen(root);
    if (!ok) return;

    const nameInput = await vscode.window.showInputBox({
      title: 'New Bao App Name',
      prompt: 'Will be created under xous-core/apps-dabao/<name>/',
      placeHolder: 'test_app',
      validateInput: (val) => {
        const n = (val || '').trim().toLowerCase();
        if (!n) return 'App name is required';
        if (!isLikelyValidAppName(n)) return 'Use lowercase letters, numbers, -, _; start with a letter';
        return null;
      }
    });
    if (!nameInput) return;

    const name = nameInput.trim().toLowerCase();

    const progressOpts = { location: vscode.ProgressLocation.Notification, title: `Creating app "${name}"…` };
    try {
      await vscode.window.withProgress(progressOpts, async () => {
        await createBaoAppViaCli(root, name);
      });

      await setXousAppName(name);
      vscode.window.showInformationMessage(`Created apps-dabao/${name} and added to workspace.`);
      await revealAppFolder(root, name);
    } catch (e: any) {
      vscode.window.showErrorMessage(`Create app failed: ${e?.message || String(e)}`);
    }
  });
}
