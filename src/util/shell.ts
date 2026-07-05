/** Build a `cd` command that safely quotes the target directory for the platform's shell. */
export function shellCd(dir: string, platform: NodeJS.Platform = process.platform): string {
	if (platform === 'win32') return `cd "${dir}"`;
	return `cd '${dir.replace(/'/g, "'\\''")}'`;
}

/**
 * Quote a command-line token for the platform's default shell, unless it consists entirely of
 * shell-safe characters. POSIX wraps in single quotes (every metacharacter inert, same style as
 * shellCd). Windows wraps in double quotes with embedded " escaped; PowerShell still expands $
 * and backtick inside double quotes, so shell-active values must be rejected before they reach
 * a command line (see the build target / app name / crate name checks in buildService).
 */
export function quoteArg(s: string, platform: NodeJS.Platform = process.platform): string {
	if (/^[A-Za-z0-9_.,:=+/-]+$/.test(s)) return s;
	if (platform === 'win32') return `"${s.replace(/"/g, '\\"')}"`;
	return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * True if `cmd` is a full/absolute path (it contains a path separator), meaning it should be spawned
 * WITHOUT a shell so spaces and metacharacters in the path pass through natively. Bare command names
 * (e.g. `uv`, `uv.exe`, `py -3`) return false: they need a shell for PATH/PATHEXT resolution.
 */
export function isFullPathCommand(cmd: string): boolean {
	return /[\\/]/.test(cmd);
}
