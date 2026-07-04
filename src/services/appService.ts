import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppsDir, XOUS_CORE_REPO } from '@constants';
import { getBuildTarget, getXousAppName, setXousAppName } from '@services/configService';
import { getProjectMode } from '@services/projectModeService';
import { getExtensionRoot } from '@services/uvService';
import { ensureXousWorkspaceOpen } from '@services/workspaceService';
import { resolveXousRootOrNotify } from '@services/xousCoreService';
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
		const m = content.match(/^members\s*=\s*\[([\s\S]*?)\]/m);
		if (!m) return [];
		return [...m[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
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

function addWorkspaceMember(xousRoot: string, member: string): void {
	const cargoPath = path.join(xousRoot, 'Cargo.toml');
	const content = fs.readFileSync(cargoPath, 'utf8');
	const updated = content.replace(/(^members\s*=\s*\[[\s\S]*?)(\n\])/m, `$1\n  "${member}",$2`);
	if (updated === content) {
		vscode.window.showWarningMessage(
			vscode.l10n.t(
				'Could not automatically add "{0}" to the workspace members in Cargo.toml. Add it manually.',
				member,
			),
		);
		return;
	}
	fs.writeFileSync(cargoPath, updated, 'utf8');
}

/* ------------------------------ app creation ------------------------------ */

/**
 * Generate a [patch."https://github.com/betrusted-io/xous-core"] section by
 * finding all git deps in the Cargo.toml that point to xous-core and mapping
 * them to local workspace paths.
 */
function generateXousPatchSection(
	cargoContent: string,
	pkgMap: Map<string, string>,
	newDir: string,
	xousRoot: string,
): string {
	const entries: string[] = [];
	// Match dependency entries that use the xous-core git URL
	const pattern =
		/^\s*([\w-]+)\s*=\s*\{[^}]*git\s*=\s*"https:\/\/github\.com\/betrusted-io\/xous-core"[^}]*\}/gm;
	const seen = new Set<string>();
	for (const m of cargoContent.matchAll(pattern)) {
		const entry = m[0];
		const depKey = m[1].trim();
		// Crate may be aliased via package = "..."
		const pkgMatch = entry.match(/package\s*=\s*"([^"]+)"/);
		const pkgName = pkgMatch ? pkgMatch[1] : depKey;
		if (seen.has(pkgName)) continue;
		seen.add(pkgName);
		const memberPath = pkgMap.get(pkgName);
		if (memberPath) {
			const absPath = path.join(xousRoot, memberPath);
			const relPath = path.relative(newDir, absPath).replace(/\\/g, '/');
			entries.push(`${pkgName} = { path = "${relPath}" }`);
		}
	}
	if (entries.length === 0) return '';
	return `\n[patch."${XOUS_CORE_REPO}"]\n${entries.join('\n')}\n`;
}

export async function createBaoApp(
	xousRoot: string,
	appName: string,
	target: string,
): Promise<void> {
	const appsDir = path.join(xousRoot, getAppsDir(target));
	const newDir = path.join(appsDir, appName);

	if (fs.existsSync(newDir)) {
		throw new Error(`App directory already exists: ${newDir}`);
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

	// Build workspace map for patch generation
	const pkgMap = buildWorkspacePackageMap(xousRoot);

	// Process Cargo.toml
	let cargo = fs.readFileSync(path.join(templateDir, 'Cargo.toml'), 'utf8');

	// Replace package name
	cargo = cargo.replace(/\{\{NAME\}\}/g, appName);

	// Remove rev = "{{REV}}" - not needed since we patch with local paths
	cargo = cargo.replace(/,?\s*rev\s*=\s*"{{REV}}"/g, '');

	// Remove [patch.crates-io] section - workspace members inherit workspace-level patches
	cargo = `${cargo.replace(/\[patch\.crates-io\][\s\S]*?(?=\n\[|\s*$)/, '').trimEnd()}\n`;

	// Generate and append [patch."https://github.com/betrusted-io/xous-core"] section
	const patchSection = generateXousPatchSection(cargo, pkgMap, newDir, xousRoot);
	if (patchSection) {
		cargo += patchSection;
	}

	// Write app files
	fs.mkdirSync(newDir, { recursive: true });
	fs.writeFileSync(path.join(newDir, 'Cargo.toml'), cargo, 'utf8');

	// Copy src/
	fs.cpSync(path.join(templateDir, 'src'), path.join(newDir, 'src'), { recursive: true });

	// Copy .cargo/config.toml
	fs.mkdirSync(path.join(newDir, '.cargo'), { recursive: true });
	fs.copyFileSync(
		path.join(templateDir, '.cargo', 'config.toml'),
		path.join(newDir, '.cargo', 'config.toml'),
	);

	// Register in workspace Cargo.toml
	addWorkspaceMember(xousRoot, `${getAppsDir(target)}/${appName}`);

	try {
		await vscode.workspace.saveAll();
	} catch {}
}
