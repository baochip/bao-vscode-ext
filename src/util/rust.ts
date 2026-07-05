/** Extract the semver (e.g. "1.87.0") from `rustc --version` output, or null if not found. */
export function parseRustcVersion(stdout: string): string | null {
	const m = stdout.match(/rustc (\d+\.\d+\.\d+)/);
	return m ? m[1] : null;
}

/**
 * Index of the release tag with the highest numeric patch suffix after `version`
 * (e.g. "1.87.0.2" beats "1.87.0.1" for version "1.87.0"; a bare "1.87.0" counts as patch 0).
 * Tags without a parsable ".N" suffix rank lowest, and ties keep the earliest index, so with a
 * newest-first release list (GitHub's order) the newest release wins when no patch is parsable.
 */
export function pickHighestPatchIndex(tags: string[], version: string): number {
	let best = 0;
	let bestPatch = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < tags.length; i++) {
		const rest = tags[i].startsWith(version) ? tags[i].slice(version.length) : null;
		const m = rest === null ? null : /^\.(\d+)$/.exec(rest);
		const patch = m ? Number(m[1]) : rest === '' ? 0 : -1;
		if (patch > bestPatch) {
			best = i;
			bestPatch = patch;
		}
	}
	return best;
}
