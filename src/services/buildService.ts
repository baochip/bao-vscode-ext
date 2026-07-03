import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppsDir, XOUS_TARGET_TRIPLE } from '@constants';
import { appExists, missingApps } from '@services/appService';
import { getBuildTarget, getExtraFeatures, getXousAppName } from '@services/configService';
import { getChannel } from '@services/logService';
import { ensureXousFolderOpen, resolveXousRootOrNotify } from '@services/pathService';
import { runProcess } from '@services/procService';
import { getOutOfTreeRoot, getProjectMode, type ProjectMode } from '@services/projectModeService';
import { checkRustToolchain } from '@services/rustCheckService';
import { ensureNamedTerminal } from '@services/terminalService';
import { checkXousAppUf2 } from '@services/xousToolsService';
import { buildOutOfTreeFeatures, parseCargoPackageName } from '@util/cargo';
import { quoteArg, shellCd } from '@util/shell';
import * as vscode from 'vscode';

export type BuildPrereqs = {
	mode: ProjectMode;
	root: string;
	target: string;
	app?: string;
};

/** Return the configured build target, or prompt to select one and return undefined. */
export async function ensureBuildTargetOrPrompt(): Promise<string | undefined> {
	const target = getBuildTarget();
	if (target) return target;
	const selectLabel = vscode.l10n.t('Select Target');
	const action = await vscode.window.showWarningMessage(
		vscode.l10n.t('No build target set.'),
		selectLabel,
	);
	if (action === selectLabel) {
		await vscode.commands.executeCommand('baochip.selectBuildTarget');
	}
	return undefined;
}

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

	const root = await resolveXousRootOrNotify();
	if (!root) return;

	const wsState = await ensureXousFolderOpen(root);
	if (wsState === 'reopen') return;

	const target = await ensureBuildTargetOrPrompt();
	if (!target) return;

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

function outOfTreeFeatureArgs(): string[] {
	return buildOutOfTreeFeatures(getBuildTarget(), getExtraFeatures());
}

/** Out-of-tree standalone build: open a terminal, build, then convert ELF to UF2. */
export function runOutOfTreeBuildInTerminal(root: string) {
	const term = ensureNamedTerminal(vscode.l10n.t('Bao Build'));
	term.sendText(shellCd(root));

	const buildCmd = `cargo build --release --target ${XOUS_TARGET_TRIPLE} ${outOfTreeFeatureArgs().map(quoteArg).join(' ')}`;

	// Read package name to construct ELF path for xous-app-uf2
	try {
		const cargo = fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8');
		const pkgName = parseCargoPackageName(cargo);
		if (pkgName) {
			const elfPath = `target/${XOUS_TARGET_TRIPLE}/release/${pkgName}`;
			const uf2Cmd = `xous-app-uf2 --elf ${quoteArg(elfPath)}`;
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
	const term = ensureNamedTerminal(vscode.l10n.t('Bao Build'));

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
	term.sendText(
		`cargo xtask ${quoteArg(target)}${appArgs.length ? ` ${appArgs.map(quoteArg).join(' ')}` : ''}`,
	);
	term.show(true);
}

function getBuildChannel(): vscode.OutputChannel {
	return getChannel(vscode.l10n.t('Bao Build'));
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
		async (_progress, token) => {
			const r = await runProcess('cargo', args, {
				cwd: root,
				token,
				onStdout: (s) => chan.append(s),
				onStderr: (s) => chan.append(s),
			});
			if (r.cancelled) {
				chan.appendLine(`[bao] ${vscode.l10n.t('Build cancelled by user.')}`);
			}
			const code = r.error ? 1 : (r.code ?? 1);
			chan.appendLine(`[bao] ${vscode.l10n.t('Build exited with code {0}', code)}`);
			return code;
		},
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
		async (_progress, token) => {
			const r = await runProcess('cargo', args, {
				cwd: root,
				token,
				onStdout: (s) => chan.append(s),
				onStderr: (s) => chan.append(s),
			});
			if (r.cancelled) {
				chan.appendLine(`[bao] ${vscode.l10n.t('Build cancelled by user.')}`);
			}
			const code = r.error ? 1 : (r.code ?? 1);
			chan.appendLine(`[bao] ${vscode.l10n.t('Build exited with code {0}', code)}`);
			return code;
		},
	);
}
