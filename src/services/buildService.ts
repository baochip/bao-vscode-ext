import { spawn } from 'node:child_process';
import { appExists, listBaoApps, missingApps } from '@services/appService';
import { getBuildTarget, getXousAppName } from '@services/configService';
import { ensureXousCorePath, ensureXousFolderOpen } from '@services/pathService';
import { checkRustToolchain } from '@services/rustCheckService';
import * as vscode from 'vscode';

export type BuildPrereqs = {
	root: string;
	target: string;
	app?: string;
};

export async function ensureBuildPrereqs(): Promise<BuildPrereqs | undefined> {
	const ok = await checkRustToolchain();
	if (!ok) return;

	let root: string;
	try {
		root = await ensureXousCorePath();
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		vscode.window.showErrorMessage(message || vscode.l10n.t('xous-core path not set'));
		return;
	}

	const wsState = await ensureXousFolderOpen(root);
	if (wsState === 'reopen') return;

	const target = getBuildTarget();
	if (!target) {
		const action = await vscode.window.showWarningMessage(
			vscode.l10n.t('No build target set.'),
			vscode.l10n.t('Select Target'),
		);
		if (action === vscode.l10n.t('Select Target')) {
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
					? vscode.l10n.t(
							'These apps were not found under {0}: {1}',
							`${root}/apps-dabao`,
							missing.join(', '),
						)
					: vscode.l10n.t(
							'App "{0}" was not found under {1}.',
							missing[0] || app,
							`${root}/apps-dabao`,
						),
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
		vscode.window.terminals.find((t) => t.name === vscode.l10n.t('Bao Build')) ??
		vscode.window.createTerminal({ name: vscode.l10n.t('Bao Build') });

	const appArgs = app ? app.trim().split(/\s+/).filter(Boolean) : [];
	const appList = appArgs.join(' ');

	if (appArgs.length === 0) {
		vscode.window.showInformationMessage(vscode.l10n.t('Building "{0}" without an app.', target));
		term.sendText(
			`echo [bao] ${vscode.l10n.t('No apps specified — building target "{0}" only.', target)}`,
		);
	} else {
		vscode.window.showInformationMessage(
			vscode.l10n.t('Building "{0}" for app "{1}"…', target, appList),
		);
	}

	term.sendText(`cd "${root}"`);
	term.sendText(`cargo xtask ${target}${app ? ` ${app}` : ''}`);
	term.show(true);
}

/** Pipeline-friendly build: spawn & wait; spinner + output channel; returns exit code. */
export async function runBuildAndWait(root: string, target: string, app?: string): Promise<number> {
	const chan = vscode.window.createOutputChannel(vscode.l10n.t('Bao Build'));
	chan.show(true);

	const appArgs = app ? app.trim().split(/\s+/).filter(Boolean) : [];
	const args = ['xtask', target, ...appArgs];
	const appList = appArgs.join(' ');

	if (appArgs.length === 0) {
		chan.appendLine(
			`[bao] ${vscode.l10n.t('No apps specified — building target "{0}" only.', target)}`,
		);
		vscode.window.showInformationMessage(vscode.l10n.t('Building "{0}" without an app.', target));
	} else {
		vscode.window.showInformationMessage(
			vscode.l10n.t('Building "{0}" for app "{1}"…', target, appList),
		);
	}

	// technical context lines, partially localized but keeping code tokens literal
	chan.appendLine(`[bao] ${vscode.l10n.t('Building: cargo {0}', args.join(' '))}`);
	chan.appendLine(`[bao] cwd: ${root}`); // kept literal: technical token

	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Building…'),
			cancellable: true,
		},
		(_progress, token) =>
			new Promise<number>((resolve) => {
				const child = spawn('cargo', args, { cwd: root, shell: process.platform === 'win32' });

				token.onCancellationRequested(() => {
					try {
						child.kill();
					} catch {}
					chan.appendLine(`[bao] ${vscode.l10n.t('Build cancelled by user.')}`);
				});

				child.stdout.on('data', (d) => chan.append(d.toString()));
				child.stderr.on('data', (d) => chan.append(d.toString()));
				child.on('close', (code) => {
					chan.appendLine(`[bao] ${vscode.l10n.t('Build exited with code {0}', code ?? 1)}`);
					resolve(code ?? 1);
				});
			}),
	);
}
