import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppsDir } from '@constants';
import { getBuildTarget, getXousAppName, setXousAppName } from '@services/configService';
import { getProjectMode } from '@services/projectModeService';
import { getExtensionRoot } from '@services/uvService';
import { ensureXousWorkspaceOpen } from '@services/workspaceService';
import { resolveXousRootOrNotify } from '@services/xousCoreService';
import {
	addWorkspaceMemberToToml,
	parseWorkspaceMembers,
	rewriteXousGitDepsToPaths,
	transformAppCargoToml,
} from '@util/cargo';
import { isDirectory } from '@util/fsUtil';
import * as vscode from 'vscode';

export async function listBaoApps(xousRoot: string, target: string): Promise<string[]> {
	const appsDir = path.join(xousRoot, getAppsDir(target));
	if (!isDirectory(appsDir)) return [];
	const entries = fs.readdirSync(appsDir, { withFileTypes: true });
	return entries
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((name) => fs.existsSync(path.join(appsDir, name, 'Cargo.toml')))
		.sort((a, b) => a.localeCompare(b));
}

/**
 * Prompt the user to pick an app for the current xous-core workspace, persist it, and return it.
 * Returns undefined in out-of-tree mode, if no apps exist, or if the user cancels.
 */
export async function promptAndSaveApp(): Promise<string | undefined> {
	if (getProjectMode() === 'out-of-tree') return undefined;

	const root = await resolveXousRootOrNotify();
	if (!root) return undefined;

	// Enforce opening xous-core as the workspace
	const ok = await ensureXousWorkspaceOpen(root);
	if (!ok) return undefined;

	const target = getBuildTarget() || 'dabao';
	const apps = await listBaoApps(root, target);
	if (apps.length === 0) {
		vscode.window.showWarningMessage(
			vscode.l10n.t('No apps found under {0}. Create one first.', `${root}/${getAppsDir(target)}`),
		);
		return undefined;
	}

	const current = getXousAppName();
	const pick = await vscode.window.showQuickPick(
		apps.map((a) => ({
			label: a,
			description: a === current ? vscode.l10n.t('current') : undefined,
		})),
		{ placeHolder: vscode.l10n.t('Select app') },
	);
	if (!pick) return undefined;

	await setXousAppName(pick.label);
	vscode.window.showInformationMessage(vscode.l10n.t('Bao app set to {0}', pick.label));
	return pick.label;
}

export function missingApps(xousRoot: string, appNames: string, target: string): string[] {
	const appsDir = path.join(xousRoot, getAppsDir(target));
	return appNames
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.filter((n) => {
			const dir = path.join(appsDir, n);
			return !(isDirectory(dir) && fs.existsSync(path.join(dir, 'Cargo.toml')));
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
		try {
			const content = fs.readFileSync(path.join(xousRoot, member, 'Cargo.toml'), 'utf8');
			const m = content.match(/^name\s*=\s*"([^"]+)"/m);
			if (m) map.set(m[1], member);
		} catch {}
	}
	return map;
}

/** Returns true when the member was added; false when the members array could not be edited. */
function addWorkspaceMember(xousRoot: string, member: string): boolean {
	const cargoPath = path.join(xousRoot, 'Cargo.toml');
	const content = fs.readFileSync(cargoPath, 'utf8');
	const updated = addWorkspaceMemberToToml(content, member);
	if (updated === null) {
		vscode.window.showWarningMessage(
			vscode.l10n.t(
				'Could not automatically add "{0}" to the workspace members in Cargo.toml. Add it manually.',
				member,
			),
		);
		return false;
	}
	fs.writeFileSync(cargoPath, updated, 'utf8');
	return true;
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
	if (!fs.existsSync(path.join(templateDir, 'Cargo.toml'))) {
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
	const registered = addWorkspaceMember(xousRoot, `${getAppsDir(target)}/${appName}`);

	try {
		await vscode.workspace.saveAll();
	} catch {}
	return registered;
}
