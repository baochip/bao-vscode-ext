/** Extract the package name (first top-level `name = "..."`) from Cargo.toml contents, or null if absent. */
export function parseCargoPackageName(toml: string): string | null {
	const m = toml.match(/^name\s*=\s*"([^"]+)"/m);
	return m ? m[1] : null;
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
