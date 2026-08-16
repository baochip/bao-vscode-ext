import * as fs from 'node:fs';
import * as path from 'node:path';
import { Commands } from '@commands/commandIds';
import { BUILD_TARGETS, getAppsDir } from '@constants';
import {
	getBuildTargetOrDefault,
	getXousAppName,
	getXousCorePath,
	setXousAppName,
} from '@services/configService';
import { warn } from '@services/logService';
import {
	findOutOfTreeRoot,
	findXousCoreInWorkspace,
	getOutOfTreeRoot,
	getProjectMode,
} from '@services/projectModeService';
import { getExtensionRoot } from '@services/uvService';
import { ensureXousWorkspaceOpen } from '@services/workspaceService';
import { resolveXousRootOrNotify } from '@services/xousCoreService';
import { splitAppNames } from '@util/appName';
import {
	addWorkspaceMemberToToml,
	discoverOutOfTreeCrates,
	parseWorkspaceMembers,
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
	return discoverOutOfTreeCrates(root).crates.length > 1;
}

/** Names in the setting matching no crate here. Empty when the crates cannot be determined. */
export function unknownAppNames(): string[] {
	const names = splitAppNames(getXousAppName());
	if (names.length === 0) return [];

	if (getProjectMode() === 'out-of-tree') {
		const root = findOutOfTreeRoot();
		if (!root) return [];
		const known = discoverOutOfTreeCrates(root).crates.map((crate) => crate.name);
		if (known.length === 0) return [];
		return names.filter((name) => !known.includes(name));
	}

	const root = findXousCoreInWorkspace() || getXousCorePath();
	if (!root) return [];
	return missingApps(root, getXousAppName(), getBuildTargetOrDefault());
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
	if (selected.length > 0) return selected;

	const available = listOutOfTreeCrates(root);
	if (available.length === 0) {
		vscode.window.showErrorMessage(vscode.l10n.t('No crates found in {0}.', root));
		return undefined;
	}

	if (available.length === 1) {
		await setXousAppName(available[0]);
		return available;
	}

	const picked = await promptAndSaveApp();
	return picked ? splitAppNames(picked) : undefined;
}

export async function listBaoApps(xousRoot: string, target: string): Promise<string[]> {
	const appsDir = path.join(xousRoot, getAppsDir(target));
	if (!isDirectory(appsDir)) return [];
	const entries = fs.readdirSync(appsDir, { withFileTypes: true });
	return entries
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((name) => hasCargoToml(path.join(appsDir, name)))
		.sort((a, b) => a.localeCompare(b));
}

/**
 * Multi-select over `available`, pre-checked from the current setting and saved back
 * space-separated. Selecting nothing leaves the setting alone rather than clearing it.
 */
async function pickAndSaveApps(
	available: string[],
	placeHolder: string,
): Promise<string | undefined> {
	const current = splitAppNames(getXousAppName());
	const picked = await vscode.window.showQuickPick(
		available.map((name) => ({ label: name, picked: current.includes(name) })),
		{ placeHolder, canPickMany: true },
	);
	if (!picked || picked.length === 0) return undefined;

	const selection = picked.map((item) => item.label).join(' ');
	await setXousAppName(selection);
	vscode.window.showInformationMessage(vscode.l10n.t('Baochip app set to: {0}', selection));
	return selection;
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

	return pickAndSaveApps(crates, vscode.l10n.t('Select crate'));
}

/**
 * Prompt the user to pick an app for the current project, persist it, and return it.
 * Returns undefined if nothing is available or the user cancels.
 */
export async function promptAndSaveApp(): Promise<string | undefined> {
	// picking would overwrite a setting the user may have meant
	const unknown = unknownAppNames();
	if (unknown.length > 0) {
		const settingsLabel = vscode.l10n.t('Open Baochip Settings');
		const choice = await vscode.window.showWarningMessage(
			vscode.l10n.t('Not found in this project: {0}', unknown.join(', ')),
			settingsLabel,
		);
		if (choice === settingsLabel) {
			await vscode.commands.executeCommand(Commands.openSettings);
		}
		return undefined;
	}

	if (getProjectMode() === 'out-of-tree') return promptAndSaveOutOfTreeCrate();

	const root = await resolveXousRootOrNotify();
	if (!root) return undefined;

	// Enforce opening xous-core as the workspace. The user may adopt the currently-open folder,
	// so list apps from the returned root, not the configured one they might have declined.
	const effectiveRoot = await ensureXousWorkspaceOpen(root);
	if (!effectiveRoot) return undefined;

	const target = getBuildTargetOrDefault();
	const apps = await listBaoApps(effectiveRoot, target);
	if (apps.length === 0) {
		vscode.window.showWarningMessage(
			vscode.l10n.t(
				'No apps found under {0}. Create one first.',
				path.join(effectiveRoot, getAppsDir(target)),
			),
		);
		return undefined;
	}

	return pickAndSaveApps(apps, vscode.l10n.t('Select app'));
}

export function missingApps(xousRoot: string, appNames: string, target: string): string[] {
	const appsDir = path.join(xousRoot, getAppsDir(target));
	return splitAppNames(appNames).filter((n) => {
		const dir = path.join(appsDir, n);
		return !(isDirectory(dir) && hasCargoToml(dir));
	});
}

export function appExists(xousRoot: string, appNames: string, target: string): boolean {
	return missingApps(xousRoot, appNames, target).length === 0;
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
		throw new Error(vscode.l10n.t('Invalid build target: {0}', target));
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
		throw new Error(vscode.l10n.t('No out-of-tree template available for target "{0}".', target));
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
