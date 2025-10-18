import * as vscode from 'vscode';
import { ensureXousCorePath } from '@services/pathService';
import { getBuildTarget, getXousAppName } from '@services/configService';
import { listBaoApps } from '@services/appService';

function ensureTerminal(name: string): vscode.Terminal {
  const existing = vscode.window.terminals.find(t => t.name === name);
  return existing ?? vscode.window.createTerminal({ name });
}

export function registerBuildCommand(_context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand('baochip.build', async () => {
    let root: string;
    try {
      root = await ensureXousCorePath();
    } catch (e: any) {
      vscode.window.showErrorMessage(e?.message || 'xous-core path not set');
      return;
    }

    const target = getBuildTarget() || 'dabao';
    let app = getXousAppName();

    // if no app chosen yet, prompt from apps-dabao
    if (!app) {
      const apps = await listBaoApps(root);
      if (apps.length === 0) {
        vscode.window.showWarningMessage(`No apps found under ${root}\\apps-dabao. Create one first.`);
        return;
      }
      const pick = await vscode.window.showQuickPick(apps, { placeHolder: 'Select app workspace to build' });
      if (!pick) return;
      app = pick;
    }

    const term = ensureTerminal('Bao Build');
    term.sendText(`cd "${root}"`);
    term.sendText(`cargo xtask ${target} ${app}`);
    term.show(true);
  });
}
