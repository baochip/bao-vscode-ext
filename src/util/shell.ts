/** Build a `cd` command that safely quotes the target directory for the platform's shell. */
export function shellCd(dir: string, platform: NodeJS.Platform = process.platform): string {
	if (platform === 'win32') return `cd "${dir}"`;
	return `cd '${dir.replace(/'/g, "'\\''")}'`;
}

/** Quote a command-line token: double-quote it (escaping inner ") when it contains whitespace, a quote, or a backtick. */
export function quoteArg(s: string): string {
	return /\s|["`]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

/**
 * True if `cmd` is a full/absolute path (it contains a path separator), meaning it should be spawned
 * WITHOUT a shell so spaces and metacharacters in the path pass through natively. Bare command names
 * (e.g. `uv`, `uv.exe`, `py -3`) return false: they need a shell for PATH/PATHEXT resolution.
 */
export function isFullPathCommand(cmd: string): boolean {
	return /[\\/]/.test(cmd);
}
