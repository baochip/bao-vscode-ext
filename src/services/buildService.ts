import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { ensureXousFolderOpen, ensureXousCorePath } from '@services/pathService';
import { getBuildTarget, getXousAppName, setXousAppName } from '@services/configService';
import { listBaoApps } from '@services/appService';
import { checkRustToolchain } from '@services/rustCheckService';

export type BuildPrereqs = {
  root: string;
  target: string;
  app: string;
};

export async function ensureBuildPrereqs(): Promise<BuildPrereqs | undefined> {
  // ensure Rust
  const ok = await checkRustToolchain();
  if (!ok) return;

  // Ensure repo path
  let root: string;
  try { root = await ensureXousCorePath(); }
  catch (e: any) {
    vscode.window.showErrorMessage(e?.message || 'xous-core path not set');
    return;
  }

  // Ensure the xous-core folder is actually opened in the workspace
  const wsState = await ensureXousFolderOpen(root);
  if (wsState === 'reopen') {
    // We just triggered a window reload / new window; stop this command for now.
    return;
  }

  // Require TARGET
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

  // Require APP (prompt from apps-bao/ if unset)
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
    await setXousAppName(app);
  }

  return { root, target, app };
}

/** Standalone Build command UX: run in a VS Code terminal (non-blocking). */
export function runBuildInTerminal(root: string, target: string, app: string) {
  const term =
    vscode.window.terminals.find(t => t.name === 'Bao Build')
    ?? vscode.window.createTerminal({ name: 'Bao Build' });

  term.sendText(`cd "${root}"`);
  term.sendText(`cargo xtask ${target} ${app}`);
  term.show(true);
}

/** Pipeline-friendly build: spawn & wait; spinner + output channel; returns exit code. */
export async function runBuildAndWait(root: string, target: string, app: string): Promise<number> {
  const chan = vscode.window.createOutputChannel('Bao Build');
  chan.show(true);

  const args = ['xtask', target, app];
  chan.appendLine(`[bao] Building: cargo ${args.join(' ')}`);
  chan.appendLine(`[bao] cwd: ${root}`);

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Baochip: Building…', cancellable: true },
    (_progress, token) =>
      new Promise<number>((resolve) => {
        const child = spawn('cargo', args, { cwd: root, shell: process.platform === 'win32' });

        token.onCancellationRequested(() => {
          try { child.kill(); } catch {}
          chan.appendLine('[bao] build cancelled by user.');
        });

        child.stdout.on('data', d => chan.append(d.toString()));
        child.stderr.on('data', d => chan.append(d.toString()));
        child.on('close', code => {
          chan.appendLine(`[bao] build exit ${code}`);
          resolve(code ?? 1);
        });
      })
  );
}
