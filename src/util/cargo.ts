import * as path from 'node:path';
import { XOUS_CORE_REPO } from '../constants';

/** Extract the package name (first top-level `name = "..."`) from Cargo.toml contents, or null if absent. */
export function parseCargoPackageName(toml: string): string | null {
	const m = toml.match(/^name\s*=\s*"([^"]+)"/m);
	return m ? m[1] : null;
}

/** Extract the workspace member paths from a Cargo.toml's `members = [...]` array. */
export function parseWorkspaceMembers(toml: string): string[] {
	// Drop line comments first so a commented-out "member" (or a `]` inside a comment) neither
	// leaks into the result nor truncates the array at the wrong bracket.
	const withoutComments = toml.replace(/#[^\n]*/g, '');
	const m = withoutComments.match(/^members\s*=\s*\[([\s\S]*?)\]/m);
	if (!m) return [];
	return [...m[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/**
 * Append `member` to a Cargo.toml's `members = [...]` array, returning the updated contents,
 * or null when the members array could not be located.
 */
export function addWorkspaceMemberToToml(toml: string, member: string): string | null {
	const updated = toml.replace(
		/(^members\s*=\s*\[[\s\S]*?)(\n\])/m,
		(_m, body: string, close: string) => {
			// A last member without a trailing comma would make the appended entry invalid TOML.
			// Insert the comma right after the last member's value - before any trailing comment,
			// where a comma would otherwise be commented out and still leave the array invalid.
			const lines = body.split('\n');
			for (let i = lines.length - 1; i >= 0; i--) {
				const commentAt = lines[i].indexOf('#');
				const code = (commentAt === -1 ? lines[i] : lines[i].slice(0, commentAt)).replace(
					/\s+$/,
					'',
				);
				if (!code) continue; // blank or comment-only line: keep scanning upward
				if (code.includes('"') && !code.endsWith(',')) {
					lines[i] = `${code},${lines[i].slice(code.length)}`;
				}
				break; // the last member-bearing line decides
			}
			return `${lines.join('\n')}\n  "${member}",${close}`;
		},
	);
	return updated === toml ? null : updated;
}

/** Prepare an in-tree app Cargo.toml from the bundled out-of-tree template. */
export function transformAppCargoToml(template: string, appName: string): string {
	// Replace package name
	let cargo = template.replace(/\{\{NAME\}\}/g, appName);

	// Remove rev = "{{REV}}" - in-tree deps are rewritten to local path deps afterwards
	cargo = cargo.replace(/,?\s*rev\s*=\s*"{{REV}}"/g, '');

	// Remove [patch.crates-io] section - workspace members inherit workspace-level patches
	return `${cargo.replace(/\[patch\.crates-io\][\s\S]*?(?=\n\[|\s*$)/, '').trimEnd()}\n`;
}

const XOUS_GIT_RE = new RegExp(
	`git\\s*=\\s*"${XOUS_CORE_REPO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
);

/**
 * Rewrite every xous-core git dependency to a path dependency into the checkout at `xousRoot`.
 * In-tree apps are members of the xous-core workspace, so sibling crates are referenced
 * directly by path; a [patch] section would not work anyway (cargo only honors patches in the
 * workspace ROOT manifest and ignores them in members). Other keys of each entry (features,
 * optional, ...) are preserved; branch/tag/rev pins are dropped with the git source; deps on
 * other git repos and registry deps are untouched. Returns the rewritten manifest plus the
 * crates that could not be found in the tree (stale checkout - caller decides how to surface).
 */
export function rewriteXousGitDepsToPaths(
	cargoContent: string,
	pkgMap: Map<string, string>,
	newDir: string,
	xousRoot: string,
): { toml: string; missing: string[] } {
	const missing = new Set<string>();
	const toml = cargoContent.replace(
		/^([ \t]*)([\w-]+)(\s*=\s*)\{([^}]*)\}/gm,
		(whole, indent: string, depKey: string, eq: string, body: string) => {
			if (!XOUS_GIT_RE.test(body)) return whole;
			// Crate may be aliased via package = "..."
			const pkgMatch = body.match(/package\s*=\s*"([^"]+)"/);
			const pkgName = pkgMatch ? pkgMatch[1] : depKey;
			const memberPath = pkgMap.get(pkgName);
			if (!memberPath) {
				missing.add(pkgName);
				return whole;
			}
			const relPath = path.relative(newDir, path.join(xousRoot, memberPath)).replace(/\\/g, '/');
			const newBody = body
				.replace(/git\s*=\s*"[^"]*"/, `path = "${relPath}"`)
				.replace(/,\s*(?:branch|tag|rev)\s*=\s*"[^"]*"/g, '')
				.replace(/(?:branch|tag|rev)\s*=\s*"[^"]*"\s*,\s*/g, '');
			return `${indent}${depKey}${eq}{${newBody}}`;
		},
	);
	return { toml, missing: [...missing] };
}

/** Whether a string is a plausible cargo feature name (defense-in-depth for values that become CLI args). */
export function isValidFeatureName(name: string): boolean {
	return /^[A-Za-z0-9_][A-Za-z0-9_./+-]*$/.test(name);
}

/**
 * Whether a string is a valid cargo package (crate) name: ASCII alphanumeric, `_` or `-`.
 * Stricter than feature syntax (no `.` `/` `+`); the app-name rule in @util/appName is in turn
 * a stricter lowercase UX subset of this.
 */
export function isValidCrateName(name: string): boolean {
	return /^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(name);
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
