import * as path from 'path';
import * as vscode from 'vscode';
import { ensureXousCorePath } from '@services/pathService';
import { isValidAppName, scaffoldBaoApp } from '@services/appService';
import { setXousAppName } from '@services/configService';
import { ensureXousWorkspaceOpen, revealAppFolder } from '@services/workspaceService';

export function registerCreateApp(_context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand('baochip.createApp', async () => {
    let root: string;
    try { root = await ensureXousCorePath(); }
    catch (e: any) { vscode.window.showErrorMessage(e?.message || 'xous-core path not set'); return; }

    // Enforce opening xous-core as the workspace (2B)
    const ok = await ensureXousWorkspaceOpen(root);
    if (!ok) return; // window is reloading or user cancelled

    const name = await vscode.window.showInputBox({
      title: 'New Bao App Name',
      prompt: 'Will be created under xous-core/apps-bao/<name>/',
      placeHolder: 'helloworld',
      validateInput: (val) => {
        if (!val.trim()) return 'App name is required';
        if (!isValidAppName(val.trim())) return 'Use letters, numbers, -, _; start with a letter';
        return null;
      }
    });
    if (!name) return;

    try {
      const appDir = scaffoldBaoApp(root, name.trim());
      await setXousAppName(name.trim()); // safe setter works even outside a workspace, but we’re in one now
      vscode.window.showInformationMessage(`Created ${appDir} and selected app "${name.trim()}"`);

      // Keep xous-core as the workspace, just focus the app folder in Explorer
      await revealAppFolder(root, name.trim());
    } catch (e: any) {
      vscode.window.showErrorMessage(e?.message || String(e));
    }
  });
}
