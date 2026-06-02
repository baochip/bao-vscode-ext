import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppsDir, XOUS_TARGET_TRIPLE } from '@constants';
import { appExists, missingApps } from '@services/appService';
import { getBuildTarget, getExtraFeatures, getXousAppName } from '@services/configService';
import { ensureXousCorePath, ensureXousFolderOpen } from '@services/pathService';
import { getOutOfTreeRoot, getProjectMode, type ProjectMode } from '@services/projectModeService';
import { checkRustToolchain } from '@services/rustCheckService';
import { checkXousAppUf2 } from '@services/xousToolsService';
import * as vscode from 'vscode';

export type BuildPrereqs = {
	mode: ProjectMode;
	root: string;
	target: string;
	app?: string;
};

export async function ensureBuildPrereqs(): Promise<BuildPrereqs | undefined> {
	const ok = await checkRustToolchain();
	if (!ok) return;

	if (getProjectMode() === 'out-of-tree') {
		const hasUf2Tool = await checkXousAppUf2();
		if (!hasUf2Tool) return;

		const root = getOutOfTreeRoot();
		if (!root) return;
		return { mode: 'out-of-tree', root, target: '' };
	}

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
		if (!appExists(root, app, target)) {
			const missing = missingApps(root, app, target);
			vscode.window.showErrorMessage(
				missing.length > 1
					? vscode.l10n.t(
							'These apps were not found under {0}: {1}',
							`${root}/${getAppsDir(target)}`,
							missing.join(', '),
						)
					: vscode.l10n.t(
							'App "{0}" was not found under {1}.',
							missing[0] || app,
							`${root}/${getAppsDir(target)}`,
						),
			);
			return;
		}
	}

	return { mode: 'xous-core', root, target, app: app || undefined };
}

function shellCd(dir: string): string {
	if (process.platform === 'win32') return `cd "${dir}"`;
	return `cd '${dir.replace(/'/g, "'\\''")}'`;
}

function outOfTreeFeatureArgs(): string[] {
	const boardFeature = `board-${getBuildTarget() || 'dabao'}`;
	return [
		'--features',
		boardFeature,
		'--features',
		'bao1x',
		'--features',
		'utralib/bao1x',
		...getExtraFeatures().flatMap((f) => ['--features', f]),
	];
}

/** Out-of-tree standalone build: open a terminal, build, then convert ELF to UF2. */
export function runOutOfTreeBuildInTerminal(root: string) {
	const term =
		vscode.window.terminals.find((t) => t.name === vscode.l10n.t('Bao Build')) ??
		vscode.window.createTerminal({ name: vscode.l10n.t('Bao Build') });
	term.sendText(shellCd(root));

	const buildCmd = `cargo build --release --target ${XOUS_TARGET_TRIPLE} ${outOfTreeFeatureArgs().join(' ')}`;

	// Read package name to construct ELF path for xous-app-uf2
	try {
		const cargo = fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8');
		const m = cargo.match(/^name\s*=\s*"([^"]+)"/m);
		if (m) {
			const elfPath = `target/${XOUS_TARGET_TRIPLE}/release/${m[1]}`;
			const uf2Cmd = `xous-app-uf2 --elf ${elfPath}`;
			// PowerShell 5.x (shipped with Windows) does not support &&
			const chainedCmd =
				process.platform === 'win32'
					? `${buildCmd}; if ($LASTEXITCODE -eq 0) { ${uf2Cmd} }`
					: `${buildCmd} && ${uf2Cmd}`;
			term.sendText(chainedCmd);
		} else {
			term.sendText(buildCmd);
		}
	} catch {
		term.sendText(buildCmd);
	}

	term.show(true);
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

	term.sendText(shellCd(root));
	term.sendText(`cargo xtask ${target}${app ? ` ${app}` : ''}`);
	term.show(true);
}

let _buildChan: vscode.OutputChannel | undefined;
function getBuildChannel(): vscode.OutputChannel {
	if (!_buildChan) _buildChan = vscode.window.createOutputChannel(vscode.l10n.t('Bao Build'));
	return _buildChan;
}

/** Out-of-tree build: cargo build with fixed Baochip target and features. Returns exit code. */
export async function runOutOfTreeBuildAndWait(root: string): Promise<number> {
	const chan = getBuildChannel();
	chan.clear();
	chan.show(true);

	const args = ['build', '--release', '--target', XOUS_TARGET_TRIPLE, ...outOfTreeFeatureArgs()];

	vscode.window.showInformationMessage(vscode.l10n.t('Baochip: Building…'));
	chan.appendLine(`[bao] ${vscode.l10n.t('Building: cargo {0}', args.join(' '))}`);
	chan.appendLine(`[bao] cwd: ${root}`);

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

/** Pipeline-friendly build: spawn & wait; spinner + output channel; returns exit code. */
export async function runBuildAndWait(root: string, target: string, app?: string): Promise<number> {
	const chan = getBuildChannel();
	chan.clear();
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
