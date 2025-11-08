import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { ensureXousFolderOpen, ensureXousCorePath } from '@services/pathService';
import { getBuildTarget, getXousAppName } from '@services/configService';
import { listBaoApps, appExists, missingApps } from '@services/appService';
import { checkRustToolchain } from '@services/rustCheckService';

export type BuildPrereqs = {
  root: string;
  target: string;
  app?: string;
};

export async function ensureBuildPrereqs(): Promise<BuildPrereqs | undefined> {
  const ok = await checkRustToolchain();
  if (!ok) return;

  let root: string;
  try { root = await ensureXousCorePath(); }
  catch (e: any) {
    vscode.window.showErrorMessage(e?.message || vscode.l10n.t('prereq.xousPathNotSet'));
    return;
  }

  const wsState = await ensureXousFolderOpen(root);
  if (wsState === 'reopen') return;

  const target = getBuildTarget();
  if (!target) {
    const action = await vscode.window.showWarningMessage(
      vscode.l10n.t('build.noTarget'),
      vscode.l10n.t('build.selectTarget')
    );
    if (action === vscode.l10n.t('build.selectTarget')) {
      await vscode.commands.executeCommand('baochip.selectBuildTarget');
    }
    return;
  }

  const app = (getXousAppName() || '').trim();
  if (app) {
    if (!appExists(root, app)) {
      const missing = missingApps(root, app);
      vscode.window.showErrorMessage(
        missing.length > 1
          ? vscode.l10n.t('app.missingMany', `${root}/apps-dabao`, missing.join(', '))
          : vscode.l10n.t('app.missingOne', missing[0] || app, `${root}/apps-dabao`)
      );
      return;
    }
  } else {
    await listBaoApps(root);
  }

  return { root, target, app: app || undefined };
}

/** Standalone Build command UX: run in a VS Code terminal (non-blocking). */
export function runBuildInTerminal(root: string, target: string, app?: string) {
  const term =
    vscode.window.terminals.find(t => t.name === vscode.l10n.t('terminal.buildName'))
    ?? vscode.window.createTerminal({ name: vscode.l10n.t('terminal.buildName') });

  const appArgs = app ? app.trim().split(/\s+/).filter(Boolean) : [];
  if (appArgs.length === 0) {
    vscode.window.showInformationMessage(vscode.l10n.t('build.noApp', target));
    term.sendText(`echo [bao] ${vscode.l10n.t('build.noAppEcho', target)}`);
  }

  term.sendText(`cd "${root}"`);
  term.sendText(`cargo xtask ${target}${app ? ` ${app}` : ''}`);
  term.show(true);
}

/** Pipeline-friendly build: spawn & wait; spinner + output channel; returns exit code. */
export async function runBuildAndWait(root: string, target: string, app?: string): Promise<number> {
  const chan = vscode.window.createOutputChannel(vscode.l10n.t('terminal.buildName'));
  chan.show(true);

  const appArgs = app ? app.trim().split(/\s+/).filter(Boolean) : [];
  const args = ['xtask', target, ...appArgs];

  if (appArgs.length === 0) {
    chan.appendLine(`[bao] ${vscode.l10n.t('build.noAppEcho', target)}`);
    vscode.window.showInformationMessage(vscode.l10n.t('build.noApp', target));
  }

  // technical context lines, partially localized but keeping code tokens literal
  chan.appendLine(`[bao] ${vscode.l10n.t('build.starting', args.join(' '))}`);
  chan.appendLine(`[bao] cwd: ${root}`); // kept literal: technical token

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('build.progressTitle'), cancellable: true },
    (_progress, token) =>
      new Promise<number>((resolve) => {
        const child = spawn('cargo', args, { cwd: root, shell: process.platform === 'win32' });

        token.onCancellationRequested(() => {
          try { child.kill(); } catch {}
          chan.appendLine(`[bao] ${vscode.l10n.t('build.cancelled')}`);
        });

        child.stdout.on('data', d => chan.append(d.toString()));
        child.stderr.on('data', d => chan.append(d.toString()));
        child.on('close', code => {
          chan.appendLine(`[bao] ${vscode.l10n.t('build.exit', code ?? 1)}`);
          resolve(code ?? 1);
        });
      })
  );
}
