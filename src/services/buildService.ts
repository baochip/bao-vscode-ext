import * as path from 'node:path';
import { BUILD_TARGETS, getAppsDir, XOUS_TARGET_TRIPLE } from '@constants';
import { appExists, ensureOutOfTreeAppSelection, missingApps } from '@services/appService';
import { appsUf2Path } from '@services/artifactsService';
import {
	getBuildTarget,
	getExtraFeatures,
	getXousAppName,
	setBuildTarget,
} from '@services/configService';
import { checkUf2Size } from '@services/flashService';
import { appendSeparator, getBaochipChannel } from '@services/logService';
import { runProcess } from '@services/procService';
import { getOutOfTreeRoot, getProjectMode } from '@services/projectModeService';
import { checkRustToolchain } from '@services/rustCheckService';
import { ensureNamedTerminal } from '@services/terminalService';
import { ensureXousFolderOpen, resolveXousRootOrNotify } from '@services/xousCoreService';
import { checkXousAppUf2 } from '@services/xousToolsService';
import { isLikelyValidAppName } from '@util/appName';
import { buildOutOfTreeFeatures, isValidCrateName } from '@util/cargo';
import { quoteArg } from '@util/shell';
import * as vscode from 'vscode';

export type BuildPrereqs =
	| { mode: 'xous-core'; root: string; target: string; app?: string }
	| { mode: 'out-of-tree'; root: string; crates: string[] };

/** Return the configured build target, prompting to select one if unset. Returns undefined if the user declines. */
export async function ensureBuildTargetOrPrompt(): Promise<string | undefined> {
	const target = getBuildTarget();
	if (target) return target;
	const selectLabel = vscode.l10n.t('Select Target');
	const action = await vscode.window.showWarningMessage(
		vscode.l10n.t('No build target set.'),
		selectLabel,
	);
	if (action === selectLabel) {
		// Return the freshly-picked target so the caller can proceed in the same run.
		return promptAndSaveBuildTarget();
	}
	return undefined;
}

/** Prompt the user to pick a build target, persist it, and return it (or undefined if cancelled). */
export async function promptAndSaveBuildTarget(): Promise<string | undefined> {
	const current = getBuildTarget();
	const picked = await vscode.window.showQuickPick(
		BUILD_TARGETS.map((t) => ({
			label: t,
			description: t === current ? vscode.l10n.t('current') : undefined,
		})),
		{ placeHolder: vscode.l10n.t('Select build target') },
	);
	if (!picked) return undefined;

	await setBuildTarget(picked.label);
	vscode.window.showInformationMessage(vscode.l10n.t('Build target set to: {0}', picked.label));
	return picked.label;
}

export async function ensureBuildPrereqs(): Promise<BuildPrereqs | undefined> {
	const ok = await checkRustToolchain();
	if (!ok) return;

	if (getProjectMode() === 'out-of-tree') {
		const hasUf2Tool = await checkXousAppUf2();
		if (!hasUf2Tool) return;

		const root = getOutOfTreeRoot();
		if (!root) return;

		const crates = await ensureOutOfTreeAppSelection(root);
		if (!crates || crates.length === 0) return;
		return { mode: 'out-of-tree', root, crates };
	}

	const root = await resolveXousRootOrNotify();
	if (!root) return;

	const wsState = await ensureXousFolderOpen(root);
	if (wsState === 'reopen') return;

	const target = await ensureBuildTargetOrPrompt();
	if (!target) return;
	// A hand-edited baochip.buildTarget flows into `cargo xtask <target>` (argv, shell:false - not
	// shell injection, but argument injection); whitelist it like the terminal build paths do.
	if (!BUILD_TARGETS.includes(target)) {
		vscode.window.showErrorMessage(vscode.l10n.t('Invalid build target: {0}', target));
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
							path.join(root, getAppsDir(target)),
							missing.join(', '),
						)
					: vscode.l10n.t(
							'App "{0}" was not found under {1}.',
							missing[0] || app,
							path.join(root, getAppsDir(target)),
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

type ShellExecutionEnd = { terminal: vscode.Terminal; exitCode: number | undefined };
type ShellExecutionWindow = {
	onDidEndTerminalShellExecution?: (listener: (e: ShellExecutionEnd) => void) => vscode.Disposable;
};

let pendingBuildWatch: (() => void) | undefined;

/**
 * Size-check the apps.uf2 a terminal build produces, once that build reports a clean exit.
 * A terminal command has no completion callback of its own, so this rides on shell integration
 * and simply does nothing where that is unavailable (the flash path still checks).
 */
function checkUf2SizeAfterBuild(term: vscode.Terminal, uf2Path: string): void {
	const onDidEnd = (vscode.window as ShellExecutionWindow).onDidEndTerminalShellExecution;
	if (!onDidEnd) return;

	pendingBuildWatch?.();

	const disposables: vscode.Disposable[] = [];
	const stop = () => {
		if (pendingBuildWatch === stop) pendingBuildWatch = undefined;
		for (const d of disposables.splice(0)) d.dispose();
	};

	disposables.push(
		onDidEnd((e) => {
			if (e.terminal !== term) return;
			stop();
			// A failed build leaves the previous apps.uf2 in place; warning about it would be a lie.
			if (e.exitCode === 0) checkUf2Size(uf2Path);
		}),
		vscode.window.onDidCloseTerminal((t) => {
			if (t === term) stop();
		}),
	);
	pendingBuildWatch = stop;
}

/** cargo args selecting only the crates to build, leaving other members alone. */
function cratePackageArgs(crates: string[]): string[] {
	return crates.flatMap((crate) => ['-p', crate]);
}

/** Each crate's ELF, relative to the root - a workspace shares one target directory. */
function crateElfPaths(crates: string[]): string[] {
	return crates.map((crate) => `target/${XOUS_TARGET_TRIPLE}/release/${crate}`);
}

/** Out-of-tree build in a terminal, chaining the UF2 conversion. */
export function runOutOfTreeBuildInTerminal(root: string, crates: string[]) {
	// Target and crate names reach a shell command line; allow only known-safe values, since
	// quoteArg cannot make $ or backtick inert inside PowerShell double quotes.
	const target = getBuildTarget();
	if (target && !BUILD_TARGETS.includes(target)) {
		vscode.window.showErrorMessage(vscode.l10n.t('Invalid build target: {0}', target));
		return;
	}
	const badCrate = crates.find((crate) => !isValidCrateName(crate));
	if (badCrate !== undefined) {
		vscode.window.showErrorMessage(vscode.l10n.t('Invalid crate name: {0}', badCrate));
		return;
	}

	const term = ensureNamedTerminal(vscode.l10n.t('Baochip Build'), root);

	const buildArgs = [...cratePackageArgs(crates), ...outOfTreeFeatureArgs()];
	const buildCmd = `cargo build --release --target ${XOUS_TARGET_TRIPLE} ${buildArgs
		.map((a) => quoteArg(a))
		.join(' ')}`;

	const uf2Args = crateElfPaths(crates).flatMap((elf) => ['--elf', elf]);
	const uf2Cmd = `xous-app-uf2 ${uf2Args.map((a) => quoteArg(a)).join(' ')}`;
	// PowerShell 5.x does not support &&
	const chainedCmd =
		process.platform === 'win32'
			? `${buildCmd}; if ($LASTEXITCODE -eq 0) { ${uf2Cmd} }`
			: `${buildCmd} && ${uf2Cmd}`;
	term.sendText(chainedCmd);
	checkUf2SizeAfterBuild(term, appsUf2Path('out-of-tree', root));

	term.show(true);
}

/** Split a whitespace-separated app string into individual app names (empty when none given). */
function splitAppArgs(app?: string): string[] {
	return app ? app.trim().split(/\s+/).filter(Boolean) : [];
}

/** Toast which target is being built, and whether any apps are included. */
function announceBuilding(target: string, appArgs: string[]) {
	vscode.window.showInformationMessage(
		appArgs.length === 0
			? vscode.l10n.t('Building "{0}" without an app.', target)
			: vscode.l10n.t('Building "{0}" for app "{1}"...', target, appArgs.join(' ')),
	);
}

/** Standalone Build command UX: run in a VS Code terminal (non-blocking). */
export function runBuildInTerminal(root: string, target: string, app?: string) {
	const appArgs = splitAppArgs(app);

	// Target and app names are workspace-controlled settings interpolated into a shell command
	// line; allow only known/identifier-like values so shell metacharacters never reach the
	// terminal (quoteArg cannot make $ or backtick inert inside PowerShell double quotes).
	if (!BUILD_TARGETS.includes(target)) {
		vscode.window.showErrorMessage(vscode.l10n.t('Invalid build target: {0}', target));
		return;
	}
	const badApp = appArgs.find((a) => !isLikelyValidAppName(a));
	if (badApp !== undefined) {
		vscode.window.showErrorMessage(vscode.l10n.t('Invalid app name: {0}', badApp));
		return;
	}

	const term = ensureNamedTerminal(vscode.l10n.t('Baochip Build'), root);

	announceBuilding(target, appArgs);
	if (appArgs.length === 0) {
		// quoted: PowerShell's echo prints each unquoted word on its own line
		term.sendText(
			`echo ${quoteArg(`[bao] ${vscode.l10n.t('No apps specified - building target "{0}" only.', target)}`)}`,
		);
	}

	term.sendText(
		`cargo xtask ${quoteArg(target)}${appArgs.length ? ` ${appArgs.map((a) => quoteArg(a)).join(' ')}` : ''}`,
	);
	checkUf2SizeAfterBuild(term, appsUf2Path('xous-core', root));
	term.show(true);
}

/**
 * Run `cargo <args>` in root, streaming output to the build channel with a cancellable
 * progress notification. Optionally prints announceLine before the command line.
 * Returns the exit code, or null when the user cancelled (not a failure).
 */
async function runCargoAndWait(
	root: string,
	args: string[],
	announceLine?: string,
): Promise<number | null> {
	const chan = getBaochipChannel();
	appendSeparator(chan, 'Build');
	chan.show(true);

	if (announceLine) {
		chan.appendLine(`[bao] ${announceLine}`);
	}
	// technical context lines, partially localized but keeping code tokens literal
	chan.appendLine(`[bao] ${vscode.l10n.t('Building: cargo {0}', args.join(' '))}`);
	chan.appendLine(`[bao] cwd: ${root}`); // kept literal: technical token

	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Building...'),
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
				return null;
			}
			if (r.error) {
				// surface the real spawn failure (e.g. cargo missing), not just a generic exit code
				chan.appendLine(
					`[bao] ${vscode.l10n.t('{0} failed to start: {1}', 'cargo', r.error.message)}`,
				);
			}
			const code = r.error ? 1 : (r.code ?? 1);
			chan.appendLine(`[bao] ${vscode.l10n.t('Build exited with code {0}', code)}`);
			return code;
		},
	);
}

/** Out-of-tree build: cargo build with fixed Baochip target and features. Returns exit code, or null when cancelled. */
export async function runOutOfTreeBuildAndWait(
	root: string,
	crates: string[],
): Promise<number | null> {
	const args = [
		'build',
		'--release',
		'--target',
		XOUS_TARGET_TRIPLE,
		...cratePackageArgs(crates),
		...outOfTreeFeatureArgs(),
	];
	return runCargoAndWait(root, args);
}

/** Pipeline-friendly build: spawn & wait; spinner + output channel; returns exit code, or null when cancelled. */
export async function runBuildAndWait(
	root: string,
	target: string,
	app?: string,
): Promise<number | null> {
	const appArgs = splitAppArgs(app);
	const args = ['xtask', target, ...appArgs];

	announceBuilding(target, appArgs);
	if (appArgs.length === 0) {
		return runCargoAndWait(
			root,
			args,
			vscode.l10n.t('No apps specified - building target "{0}" only.', target),
		);
	}
	return runCargoAndWait(root, args);
}
