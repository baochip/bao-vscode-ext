import * as vscode from 'vscode';
import { ensureXousCorePath } from '@services/pathService';
import { isValidAppName, scaffoldBaoApp } from '@services/appService';
import { setXousAppName } from '@services/configService';
import { openAppFolder } from '@services/workspaceService';
import path = require('path/win32');

export function registerCreateApp(_context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand('baochip.createApp', async () => {
    let root: string;
    try {
      root = await ensureXousCorePath();
    } catch (e: any) {
      vscode.window.showErrorMessage(e?.message || 'xous-core path not set');
      return;
    }

    const name = await vscode.window.showInputBox({
      title: 'New Bao App Name',
      prompt: 'Will be created under xous-core/apps-dabao/<name>/',
      placeHolder: 'sample',
      validateInput: (val) => {
        if (!val.trim()) return 'App name is required';
        if (!isValidAppName(val.trim())) return 'Use letters, numbers, -, _; start with a letter';
        return null;
      }
    });
    if (!name) return;

    try {
      const appDir = scaffoldBaoApp(root, name.trim());
      await setXousAppName(name.trim());
      await openAppFolder(appDir);
      vscode.window.showInformationMessage(`Created ${appDir} and selected app "${name.trim()}"`);
    } catch (e: any) {
      vscode.window.showErrorMessage(e?.message || String(e));
    }
  });
}
