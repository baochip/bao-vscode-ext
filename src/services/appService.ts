import * as fs from 'node:fs';
import * as path from 'node:path';
import { ALL_APPS_DIRS, BUILD_TARGETS, boardFeature, getAppsDir } from '@constants';
import { ensureBuildTarget } from '@services/buildTargetService';
import {
	getBuildTarget,
	getXousAppName,
	getXousCorePath,
	setXousAppName,
} from '@services/configService';
import { getBaochipChannel, warn } from '@services/logService';
import {
	findOutOfTreeRoot,
	findXousCoreInWorkspace,
	getOutOfTreeRoot,
	getProjectMode,
} from '@services/projectModeService';
import { getExtensionRoot } from '@services/uvService';
import { ensureXousWorkspaceOpen } from '@services/workspaceService';
import { resolveXousRootOrNotify } from '@services/xousCoreService';
import { crateNameOf, splitAppNames } from '@util/appName';
import {
	addWorkspaceMemberToToml,
	discoverOutOfTreeCrates,
	parseWorkspaceMembers,
	readCargoFeatures,
	readCargoPackageName,
	rewriteXousGitDepsToPaths,
	transformAppCargoToml,
} from '@util/cargo';
import { hasCargoToml, isDirectory } from '@util/fsUtil';
import * as vscode from 'vscode';

/** Whether there is a crate worth choosing between. Quiet: the status bar calls it on every refresh. */
export function hasCrateChoice(): boolean {
	if (getProjectMode() === 'xous-core') return true;
	const root = findOutOfTreeRoot();
	if (!root) return false;
	const { crates, wildcardMembers, unreadableMembers } = discoverOutOfTreeCrates(root);
	// Members we could not resolve still mean a choice exists - just one we cannot offer yet.
	return crates.length > 1 || wildcardMembers.length > 0 || unreadableMembers.length > 0;
}

export type AppStatus = 'ok' | 'not-an-app' | 'wrong-board' | 'missing';
export type AppProblem = { name: string; status: Exclude<AppStatus, 'ok'> };

/** Statuses that stop a build; a service or library is a valid thing to hand xtask. */
const BLOCKING: AppProblem['status'][] = ['wrong-board', 'missing'];

type CrateInfo = { manifestPath: string; isApp: boolean };

/**
 * Every crate in the tree by name, marking which are apps. Apps come from the apps-* directories;
 * the rest are workspace members, which xtask accepts too - dc34-console is a service.
 */
function workspaceCrates(xousRoot: string): Map<string, CrateInfo> {
	const crates = new Map<string, CrateInfo>();

	for (const member of readWorkspaceMembers(xousRoot)) {
		const dir = path.join(xousRoot, member);
		const name = readCargoPackageName(dir);
		if (name) crates.set(name, { manifestPath: path.join(dir, 'Cargo.toml'), isApp: false });
	}

	for (const appsDir of ALL_APPS_DIRS) {
		const dir = path.join(xousRoot, appsDir);
		if (!isDirectory(dir)) continue;
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const appDir = path.join(dir, entry.name);
			if (!hasCargoToml(appDir)) continue;
			crates.set(entry.name, { manifestPath: path.join(appDir, 'Cargo.toml'), isApp: true });
		}
	}

	return crates;
}

/** Where a name stands for `target`: buildable, buildable but not an app, wrong board, or absent. */
function appStatus(crates: Map<string, CrateInfo>, name: string, target: string): AppStatus {
	const info = crates.get(crateNameOf(name));
	if (!info) return 'missing';
	if (!readCargoFeatures(info.manifestPath).includes(boardFeature(target))) return 'wrong-board';
	return info.isApp ? 'ok' : 'not-an-app';
}

/** Apps this target can build, for the picker's offered list. */
function classifyApps(xousRoot: string, target: string): { ok: string[]; wrongBoard: string[] } {
	const crates = workspaceCrates(xousRoot);
	const ok: string[] = [];
	const wrongBoard: string[] = [];
	for (const [name, info] of crates) {
		if (!info.isApp) continue;
		(appStatus(crates, name, target) === 'ok' ? ok : wrongBoard).push(name);
	}
	const sorted = (names: string[]) => names.sort((a, b) => a.localeCompare(b));
	return { ok: sorted(ok), wrongBoard: sorted(wrongBoard) };
}

type Classified = { ok: string[]; wrongBoard: string[] };

/** Out-of-tree crates, split the same way: by whether the manifest declares the board feature. */
function classifyCrates(root: string, target: string): Classified {
	const ok: string[] = [];
	const wrongBoard: string[] = [];
	for (const crate of discoverOutOfTreeCrates(root).crates) {
		const declares = readCargoFeatures(crate.manifestPath).includes(boardFeature(target));
		(declares ? ok : wrongBoard).push(crate.name);
	}
	const sorted = (names: string[]) => names.sort((a, b) => a.localeCompare(b));
	return { ok: sorted(ok), wrongBoard: sorted(wrongBoard) };
}

/** Configured names that are not buildable, and why. */
function problemsFrom({ ok, wrongBoard }: Classified, appNames: string): AppProblem[] {
	return splitAppNames(appNames)
		.filter((name) => !ok.includes(name))
		.map((name) => ({
			name,
			status: wrongBoard.includes(name) ? ('wrong-board' as const) : ('missing' as const),
		}));
}

/** How each configured name stands for `target` in a xous-core tree, ok ones omitted. */
export function appProblems(xousRoot: string, appNames: string, target: string): AppProblem[] {
	const crates = workspaceCrates(xousRoot);
	return splitAppNames(appNames)
		.map((name) => ({ name, status: appStatus(crates, name, target) }))
		.filter((entry): entry is AppProblem => entry.status !== 'ok');
}

/** The subset that stops a build: a service or library is something xtask can build. */
export function blockingAppProblems(problems: AppProblem[]): AppProblem[] {
	return problems.filter((problem) => BLOCKING.includes(problem.status));
}

/** Why each configured name cannot be built for `target` out of tree. */
export function crateProblems(root: string, appNames: string, target: string): AppProblem[] {
	return problemsFrom(classifyCrates(root, target), appNames);
}

/** One message covering both ways a selected name can fail to build here. */
export function describeAppProblems(problems: AppProblem[], target: string): string {
	const named = (status: AppProblem['status']) =>
		problems
			.filter((p) => p.status === status)
			.map((p) => p.name)
			.join(', ');

	const wrongBoard = named('wrong-board');
	const missing = named('missing');
	return [
		wrongBoard &&
			vscode.l10n.t('These do not declare the board-{0} feature: {1}', target, wrongBoard),
		missing && vscode.l10n.t('Not found in this project: {0}', missing),
	]
		.filter(Boolean)
		.join(' ');
}

/**
 * What is wrong with the current app selection, if anything. Empty while there is nothing to
 * check against: no target picked, no project found, or a project whose crates cannot be read.
 */
export function currentAppProblems(): AppProblem[] {
	if (splitAppNames(getXousAppName()).length === 0) return [];

	const target = getBuildTarget();
	if (!target) return []; // nothing to compare against until a hardware target is picked

	if (getProjectMode() === 'out-of-tree') {
		const root = findOutOfTreeRoot();
		if (!root) return [];
		if (discoverOutOfTreeCrates(root).crates.length === 0) return [];
		return crateProblems(root, getXousAppName(), target);
	}

	const root = findXousCoreInWorkspace() || getXousCorePath();
	if (!root) return [];
	return appProblems(root, getXousAppName(), target);
}
/** Crate names an out-of-tree project can build, warning about members it had to skip. */
export function listOutOfTreeCrates(root: string): string[] {
	const { crates, wildcardMembers, unreadableMembers } = discoverOutOfTreeCrates(root);

	if (wildcardMembers.length > 0) {
		warn(
			vscode.l10n.t(
				'Workspace members using "*" are not supported: {0}. List each crate folder individually.',
				wildcardMembers.join(', '),
			),
		);
	}
	if (unreadableMembers.length > 0) {
		warn(
			vscode.l10n.t(
				'These workspace members have no readable Cargo.toml: {0}',
				unreadableMembers.join(', '),
			),
		);
	}

	return crates.map((crate) => crate.name);
}

/** Selected crates for an out-of-tree build; a lone crate is filled in without prompting. */
export async function ensureOutOfTreeAppSelection(root: string): Promise<string[] | undefined> {
	const selected = splitAppNames(getXousAppName());
	if (selected.length > 0) {
		// Checked here so a stale name gets this message rather than cargo's package-ID error.
		const problems = blockingAppProblems(currentAppProblems());
		if (problems.length > 0) {
			vscode.window.showErrorMessage(describeAppProblems(problems, getBuildTarget()));
			return undefined;
		}
		return selected;
	}
	const available = listOutOfTreeCrates(root);
	if (available.length === 0) {
		// listOutOfTreeCrates already said why when it could; only add the vague message otherwise.
		const { wildcardMembers, unreadableMembers } = discoverOutOfTreeCrates(root);
		if (wildcardMembers.length === 0 && unreadableMembers.length === 0) {
			vscode.window.showErrorMessage(vscode.l10n.t('No crates found in {0}.', root));
		}
		return undefined;
	}

	if (available.length === 1) {
		await setXousAppName(available[0]);
		return available;
	}

	const picked = await promptAndSaveApp();
	return picked ? splitAppNames(picked) : undefined;
}

/** Apps in the tree that can build for `target`, i.e. that declare its board feature. */
export async function listBaoApps(xousRoot: string, target: string): Promise<string[]> {
	return classifyApps(xousRoot, target).ok;
}

/**
 * Multi-select over what can actually be built, saved back space-separated. Confirming with
 * nothing checked clears the selection; dismissing the picker leaves it untouched.
 *
 * Anything selected that cannot be built here is listed too, checked and labelled with why:
 * seeing it is how a wrong target announces itself, and unchecking is how it goes away. Leaving
 * one checked keeps it, since only the user knows whether the app or the target was the mistake.
 */
async function pickAndSaveApps(
	buildable: string[],
	problems: AppProblem[],
	target: string,
	placeHolder: string,
): Promise<string | undefined> {
	const current = splitAppNames(getXousAppName());
	const picked = await vscode.window.showQuickPick(
		[
			...buildable.map((name) => ({ label: name, picked: current.includes(name) })),
			...problems.map((problem) => ({
				label: problem.name,
				picked: true,
				description: describeAppStatus(problem.status, target),
			})),
		],
		{ placeHolder, canPickMany: true },
	);
	if (!picked) return undefined; // dismissed, which is not a decision about the setting

	const selection = picked.map((item) => item.label).join(' ');
	await setXousAppName(selection);
	vscode.window.showInformationMessage(
		selection
			? vscode.l10n.t('Baochip app set to: {0}', selection)
			: vscode.l10n.t('Baochip app selection cleared.'),
	);
	return selection;
}

/** What to show beside a selected name that is not a plain app of this target. */
function describeAppStatus(status: AppProblem['status'], target: string): string {
	if (status === 'wrong-board') return vscode.l10n.t('invalid for {0}', target);
	if (status === 'not-an-app') return vscode.l10n.t('service or library');
	return vscode.l10n.t('not in this project');
}
/** Note what was left out of the picker, so an app missing from the list is still explainable. */
function logUnbuildable(names: string[], target: string): void {
	if (names.length === 0) return;
	getBaochipChannel().appendLine(
		`[bao] not offered for ${target} (no ${boardFeature(target)} feature): ${names.join(', ')}`,
	);
}

/** Pick which crates an out-of-tree project builds. */
async function promptAndSaveOutOfTreeCrate(): Promise<string | undefined> {
	const root = getOutOfTreeRoot();
	if (!root) return undefined;

	const crates = listOutOfTreeCrates(root);
	if (crates.length === 0) {
		vscode.window.showErrorMessage(vscode.l10n.t('No crates found in {0}.', root));
		return undefined;
	}

	const target = await ensureBuildTarget();
	if (!target) return undefined;

	const { ok, wrongBoard } = classifyCrates(root, target);
	logUnbuildable(wrongBoard, target);
	const problems = crateProblems(root, getXousAppName(), target);
	// Nothing buildable is still worth opening for: it is the only way to uncheck what is set.
	if (ok.length === 0 && problems.length === 0) {
		vscode.window.showWarningMessage(
			vscode.l10n.t('No crates here declare the board-{0} feature.', target),
		);
		return undefined;
	}

	return pickAndSaveApps(ok, problems, target, vscode.l10n.t('Select crate'));
}

/**
 * Prompt the user to pick an app for the current project, persist it, and return it.
 * Returns undefined if nothing is available or the user cancels.
 */
export async function promptAndSaveApp(): Promise<string | undefined> {
	if (getProjectMode() === 'out-of-tree') return promptAndSaveOutOfTreeCrate();

	const root = await resolveXousRootOrNotify();
	if (!root) return undefined;

	// Enforce opening xous-core as the workspace. The user may adopt the currently-open folder,
	// so list apps from the returned root, not the configured one they might have declined.
	const effectiveRoot = await ensureXousWorkspaceOpen(root);
	if (!effectiveRoot) return undefined;

	const target = await ensureBuildTarget();
	if (!target) return undefined;

	const { ok, wrongBoard } = classifyApps(effectiveRoot, target);
	logUnbuildable(wrongBoard, target);
	const problems = appProblems(effectiveRoot, getXousAppName(), target);
	// Nothing buildable is still worth opening for: it is the only way to uncheck what is set.
	if (ok.length === 0 && problems.length === 0) {
		vscode.window.showWarningMessage(
			wrongBoard.length > 0
				? vscode.l10n.t('No apps here declare the board-{0} feature.', target)
				: vscode.l10n.t(
						'No apps found under {0}. Create one first.',
						path.join(effectiveRoot, getAppsDir(target)),
					),
		);
		return undefined;
	}

	return pickAndSaveApps(ok, problems, target, vscode.l10n.t('Select app'));
}
/* ------------------------------ workspace helpers ------------------------------ */

function readWorkspaceMembers(xousRoot: string): string[] {
	try {
		const content = fs.readFileSync(path.join(xousRoot, 'Cargo.toml'), 'utf8');
		return parseWorkspaceMembers(content);
	} catch {
		return [];
	}
}

/** Build a map of crate-name -> workspace-relative-path by scanning workspace members. */
function buildWorkspacePackageMap(xousRoot: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const member of readWorkspaceMembers(xousRoot)) {
		const name = readCargoPackageName(path.join(xousRoot, member));
		if (name) map.set(name, member);
	}
	return map;
}

/** Returns true when the member was added; false when the members array could not be edited. */
function addWorkspaceMember(xousRoot: string, member: string): boolean {
	const cargoPath = path.join(xousRoot, 'Cargo.toml');
	try {
		const content = fs.readFileSync(cargoPath, 'utf8');
		// Already listed (e.g. recreating an app whose folder was deleted but whose entry remained)?
		// Return without appending so the members array does not accumulate duplicates.
		if (parseWorkspaceMembers(content).includes(member)) {
			return true;
		}
		const updated = addWorkspaceMemberToToml(content, member);
		if (updated !== null) {
			fs.writeFileSync(cargoPath, updated, 'utf8');
			return true;
		}
	} catch {
		// Reading or writing the root Cargo.toml failed (e.g. it is read-only): return false so the
		// caller reports the single "add it manually" message; the app itself was still created.
	}
	// Members array missing, unchanged, or unwritable: the caller surfaces the manual-add message.
	return false;
}

/* ------------------------------ app creation ------------------------------ */

/**
 * Scaffold a new in-tree app from the bundled template. Returns true when the app was also
 * registered in the root workspace members; false when it was created but the members array
 * could not be edited automatically (the user was told to add it manually).
 */
export async function createBaoApp(
	xousRoot: string,
	appName: string,
	target: string,
): Promise<boolean> {
	// target is a workspace-controlled setting interpolated into the template path below; reject
	// anything not whitelisted so it can never become a traversal path segment.
	if (!BUILD_TARGETS.includes(target)) {
		throw new Error(vscode.l10n.t('Invalid hardware target: {0}', target));
	}
	const appsDir = path.join(xousRoot, getAppsDir(target));
	const newDir = path.join(appsDir, appName);

	if (fs.existsSync(newDir)) {
		throw new Error(vscode.l10n.t('App directory already exists: {0}', newDir));
	}

	const templateDir = path.join(
		getExtensionRoot(),
		'resources',
		'templates',
		'out-of-tree',
		target,
	);
	if (!hasCargoToml(templateDir)) {
		throw new Error(
			vscode.l10n.t('No out-of-tree template available for hardware target "{0}".', target),
		);
	}

	// Build workspace map for the path-dep rewrite
	const pkgMap = buildWorkspacePackageMap(xousRoot);

	// Process Cargo.toml
	const template = fs.readFileSync(path.join(templateDir, 'Cargo.toml'), 'utf8');
	let cargo = transformAppCargoToml(template, appName);

	// In-tree apps reference sibling xous-core crates by path: cargo ignores [patch] sections
	// in member manifests, so keeping the git deps would silently resolve them from GitHub
	// instead of this tree.
	const rewrite = rewriteXousGitDepsToPaths(cargo, pkgMap, newDir, xousRoot);
	if (rewrite.missing.length > 0) {
		throw new Error(
			vscode.l10n.t(
				'Could not find {0} in your xous-core checkout. Update xous-core and try again.',
				rewrite.missing.join(', '),
			),
		);
	}
	cargo = rewrite.toml;

	// Write app files
	fs.mkdirSync(newDir, { recursive: true });
	try {
		fs.writeFileSync(path.join(newDir, 'Cargo.toml'), cargo, 'utf8');

		// Copy src/
		fs.cpSync(path.join(templateDir, 'src'), path.join(newDir, 'src'), { recursive: true });

		// Copy .cargo/config.toml
		fs.mkdirSync(path.join(newDir, '.cargo'), { recursive: true });
		fs.copyFileSync(
			path.join(templateDir, '.cargo', 'config.toml'),
			path.join(newDir, '.cargo', 'config.toml'),
		);
	} catch (e) {
		// Remove the partial app dir so a retry is not blocked by "already exists".
		try {
			fs.rmSync(newDir, { recursive: true, force: true });
		} catch {}
		throw e;
	}

	// Register in workspace Cargo.toml
	return addWorkspaceMember(xousRoot, `${getAppsDir(target)}/${appName}`);
}
