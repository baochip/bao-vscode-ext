/** Extract the package name (first top-level `name = "..."`) from Cargo.toml contents, or null if absent. */
export function parseCargoPackageName(toml: string): string | null {
	const m = toml.match(/^name\s*=\s*"([^"]+)"/m);
	return m ? m[1] : null;
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
