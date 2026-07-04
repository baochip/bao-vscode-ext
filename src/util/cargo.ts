import * as path from 'node:path';
import { XOUS_CORE_REPO } from '../constants';

/** Extract the package name (first top-level `name = "..."`) from Cargo.toml contents, or null if absent. */
export function parseCargoPackageName(toml: string): string | null {
	const m = toml.match(/^name\s*=\s*"([^"]+)"/m);
	return m ? m[1] : null;
}

/** Extract the workspace member paths from a Cargo.toml's `members = [...]` array. */
export function parseWorkspaceMembers(toml: string): string[] {
	const m = toml.match(/^members\s*=\s*\[([\s\S]*?)\]/m);
	if (!m) return [];
	return [...m[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/**
 * Append `member` to a Cargo.toml's `members = [...]` array, returning the updated contents,
 * or null when the members array could not be located.
 */
export function addWorkspaceMemberToToml(toml: string, member: string): string | null {
	const updated = toml.replace(/(^members\s*=\s*\[[\s\S]*?)(\n\])/m, `$1\n  "${member}",$2`);
	return updated === toml ? null : updated;
}

/** Prepare an in-tree app Cargo.toml from the bundled out-of-tree template. */
export function transformAppCargoToml(template: string, appName: string): string {
	// Replace package name
	let cargo = template.replace(/\{\{NAME\}\}/g, appName);

	// Remove rev = "{{REV}}" - not needed since we patch with local paths
	cargo = cargo.replace(/,?\s*rev\s*=\s*"{{REV}}"/g, '');

	// Remove [patch.crates-io] section - workspace members inherit workspace-level patches
	return `${cargo.replace(/\[patch\.crates-io\][\s\S]*?(?=\n\[|\s*$)/, '').trimEnd()}\n`;
}

/**
 * Generate a [patch."https://github.com/betrusted-io/xous-core"] section by
 * finding all git deps in the Cargo.toml that point to xous-core and mapping
 * them to local workspace paths.
 */
export function generateXousPatchSection(
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

/** Whether a string is a plausible cargo feature name (defense-in-depth for values that become CLI args). */
export function isValidFeatureName(name: string): boolean {
	return /^[A-Za-z0-9_][A-Za-z0-9_./+-]*$/.test(name);
}

/** Build the cargo `--features` args for an out-of-tree Baochip build: the board feature, fixed defaults, then any extras. */
export function buildOutOfTreeFeatures(target: string, extraFeatures: string[]): string[] {
	const boardFeature = `board-${target || 'dabao'}`;
	return [
		'--features',
		boardFeature,
		'--features',
		'bao1x',
		'--features',
		'utralib/bao1x',
		...extraFeatures.flatMap((f) => ['--features', f]),
	];
}
