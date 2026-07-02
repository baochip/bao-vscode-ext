/** Extract the semver (e.g. "1.87.0") from `rustc --version` output, or null if not found. */
export function parseRustcVersion(stdout: string): string | null {
	const m = stdout.match(/rustc (\d+\.\d+\.\d+)/);
	return m ? m[1] : null;
}
