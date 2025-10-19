import * as vscode from 'vscode';
import { ensureXousCorePath } from '@services/pathService';
import { getBuildTarget, getXousAppName } from '@services/configService';
import { listBaoApps } from '@services/appService';

function ensureTerminal(name: string): vscode.Terminal {
  return vscode.window.terminals.find(t => t.name === name)
      ?? vscode.window.createTerminal({ name });
}

export function registerBuildCommand(_context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand('baochip.build', async () => {
    // 1) Ensure repo path
    let root: string;
    try { root = await ensureXousCorePath(); }
    catch (e: any) {
      vscode.window.showErrorMessage(e?.message || 'xous-core path not set');
      return;
    }

    // 2) Require a TARGET
    const target = getBuildTarget();
    if (!target) {
      const action = await vscode.window.showWarningMessage(
        'No build target is set. Please select a target before building.',
        'Select Target'
      );
      if (action === 'Select Target') {
        await vscode.commands.executeCommand('baochip.selectBuildTarget');
      }
      return;
    }

    // 3) Require an APP name; if missing, prompt picker from apps-bao/
    let app = getXousAppName();
    if (!app) {
      const apps = await listBaoApps(root);
      if (apps.length === 0) {
        vscode.window.showWarningMessage(`No apps found under ${root}/apps-bao. Create one first.`);
        return;
      }
      const pick = await vscode.window.showQuickPick(apps, { placeHolder: 'Select app workspace to build' });
      if (!pick) return;
      app = pick;
    }

    // 4) Run build
    const term = ensureTerminal('Bao Build');
    term.sendText(`cd "${root}"`);
    term.sendText(`cargo xtask ${target} ${app}`);
    term.show(true);
  });
}
