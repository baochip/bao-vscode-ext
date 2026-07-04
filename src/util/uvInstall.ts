import * as path from 'node:path';

/** URL of Astral's uv standalone install script for the platform (always the latest release). */
export function installerScriptUrl(platform: NodeJS.Platform = process.platform): string {
	return platform === 'win32'
		? 'https://astral.sh/uv/install.ps1'
		: 'https://astral.sh/uv/install.sh';
}

/** The uv executable's filename on the platform. */
export function uvBinaryName(platform: NodeJS.Platform = process.platform): string {
	return platform === 'win32' ? 'uv.exe' : 'uv';
}

/** Full path to the uv executable inside `dir`, using the platform's path rules. */
export function uvPathIn(dir: string, platform: NodeJS.Platform = process.platform): string {
	const p = platform === 'win32' ? path.win32 : path.posix;
	return p.join(dir, uvBinaryName(platform));
}

/**
 * Standard locations a uv installed by the user (not by us) may already live: the standalone
 * installer's default target (~/.local/bin) and the legacy cargo bin (~/.cargo/bin). Probed by
 * full path when uv is not on PATH, so we reuse an existing uv instead of installing our own.
 */
export function knownUvLocations(
	homedir: string,
	platform: NodeJS.Platform = process.platform,
): string[] {
	const p = platform === 'win32' ? path.win32 : path.posix;
	const name = uvBinaryName(platform);
	return [p.join(homedir, '.local', 'bin', name), p.join(homedir, '.cargo', 'bin', name)];
}
