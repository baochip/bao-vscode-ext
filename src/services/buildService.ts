import { BUILD_TARGETS, XOUS_TARGET_TRIPLE } from '@constants';
import {
	appProblems,
	describeAppProblems,
	ensureOutOfTreeAppSelection,
} from '@services/appService';
import { projectImagePath, uf2ToolArgs } from '@services/artifactsService';
import { ensureBuildTarget } from '@services/buildTargetService';
import {
	getBuildTarget,
	getExtraFeatures,
	getInTreeBuildFlags,
	getInTreeFeatures,
	getInTreeKernelFeatures,
	getXousAppName,
} from '@services/configService';
import { checkUf2Size } from '@services/flashService';
import { appendSeparator, getBaochipChannel } from '@services/logService';
import { runProcess } from '@services/procService';
import { getOutOfTreeRoot, getProjectMode } from '@services/projectModeService';
import { checkRustToolchain } from '@services/rustCheckService';
import { ensureNamedTerminal, runInTerminal } from '@services/terminalService';
import { ensureXousFolderOpen, resolveXousRootOrNotify } from '@services/xousCoreService';
import { checkXousAppUf2 } from '@services/xousToolsService';
import { isLikelyValidAppName, splitAppNames } from '@util/appName';
import { buildOutOfTreeFeatures, isValidCrateName } from '@util/cargo';
import { quoteArg } from '@util/shell';
import * as vscode from 'vscode';

export type BuildPrereqs =
	| { mode: 'xous-core'; root: string; target: string; app?: string }
	| { mode: 'out-of-tree'; root: string; crates: string[] };

export async function ensureBuildPrereqs(): Promise<BuildPrereqs | undefined> {
	const ok = await checkRustToolchain();
	if (!ok) return;

	if (getProjectMode() === 'out-of-tree') {
		const hasUf2Tool = await checkXousAppUf2();
		if (!hasUf2Tool) return;

		// The board feature comes from the hardware target, so out-of-tree builds need one too.
		if (!(await ensureBuildTarget())) return;

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

	const target = await ensureBuildTarget();
	if (!target) return;

	const app = (getXousAppName() || '').trim();
	if (app) {
		const problems = appProblems(root, app, target);
		if (problems.length > 0) {
			vscode.window.showErrorMessage(describeAppProblems(problems, target));
			return;
		}
	}

	return { mode: 'xous-core', root, target, app: app || undefined };
}

/** Extra cargo xtask arguments from settings, in the order the xtask docs use them. */
function inTreeBuildArgs(): string[] {
	return [
		...getInTreeFeatures().flatMap((feature) => ['--feature', feature]),
		...getInTreeKernelFeatures().flatMap((feature) => ['--kernel-feature', feature]),
		...getInTreeBuildFlags(),
	];
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
export async function runOutOfTreeBuildInTerminal(root: string, crates: string[]) {
	// Target and crate names reach a shell command line; allow only known-safe values, since
	// quoteArg cannot make $ or backtick inert inside PowerShell double quotes.
	const target = await ensureBuildTarget();
	if (!target) return;
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

	const uf2Args = [
		...crateElfPaths(crates).flatMap((elf) => ['--elf', elf]),
		...uf2ToolArgs(target, root),
	];
	const uf2Cmd = `xous-app-uf2 ${uf2Args.map((a) => quoteArg(a)).join(' ')}`;
	// PowerShell 5.x does not support &&
	const chainedCmd =
		process.platform === 'win32'
			? `${buildCmd}; if ($LASTEXITCODE -eq 0) { ${uf2Cmd} }`
			: `${buildCmd} && ${uf2Cmd}`;
	await runInTerminal(term, chainedCmd);
	checkUf2SizeAfterBuild(term, projectImagePath('out-of-tree', root, target));

	term.show(true);
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
export async function runBuildInTerminal(root: string, target: string, app?: string) {
	const appArgs = splitAppNames(app);

	// Target and app names are workspace-controlled settings interpolated into a shell command
	// line; allow only known/identifier-like values so shell metacharacters never reach the
	// terminal (quoteArg cannot make $ or backtick inert inside PowerShell double quotes).
	if (!BUILD_TARGETS.includes(target)) {
		vscode.window.showErrorMessage(vscode.l10n.t('Invalid hardware target: {0}', target));
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
		await runInTerminal(
			term,
			`echo ${quoteArg(`[bao] ${vscode.l10n.t('No apps specified - building hardware target "{0}" only.', target)}`)}`,
		);
	}

	await runInTerminal(
		term,
		[
			'cargo xtask',
			quoteArg(target),
			...appArgs.map((a) => quoteArg(a)),
			...inTreeBuildArgs().map((a) => quoteArg(a)),
		].join(' '),
	);
	checkUf2SizeAfterBuild(term, projectImagePath('xous-core', root, target));
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
	const appArgs = splitAppNames(app);
	const args = ['xtask', target, ...appArgs, ...inTreeBuildArgs()];

	announceBuilding(target, appArgs);
	if (appArgs.length === 0) {
		return runCargoAndWait(
			root,
			args,
			vscode.l10n.t('No apps specified - building hardware target "{0}" only.', target),
		);
	}
	return runCargoAndWait(root, args);
}
