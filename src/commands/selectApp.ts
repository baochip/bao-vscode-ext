import * as vscode from 'vscode';
import * as path from 'path';
import { ensureXousCorePath } from '@services/pathService';
import { listBaoApps } from '@services/appService';
import { getXousAppName, setXousAppName } from '@services/configService';
import { openAppFolder } from '@services/workspaceService';

export function registerSelectApp(_context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand('baochip.selectApp', async () => {
    let root: string;
    try {
      root = await ensureXousCorePath();
    } catch (e: any) {
      vscode.window.showErrorMessage(e?.message || 'xous-core path not set');
      return;
    }

    const apps = await listBaoApps(root);
    if (apps.length === 0) {
      vscode.window.showWarningMessage(`No apps found under ${root}\\apps-dabao. Create one first.`);
      return;
    }

    const current = getXousAppName();
    const pick = await vscode.window.showQuickPick(
      apps.map(a => ({ label: a, description: a === current ? 'current' : undefined })),
      { placeHolder: 'Select an app from xous-core/apps-dabao/' }
    );
    if (!pick) return;

    await setXousAppName(pick.label);
    const appDir = path.join(root, 'apps-dabao', pick.label);
    await openAppFolder(appDir);
    vscode.window.showInformationMessage(`Bao app set to ${pick.label}`);
  });
}
