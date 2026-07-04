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

/**
 * Env that confines uv's managed-Python installs and download cache to a directory we own (the
 * extension's global storage), so nothing is written to the user's machine outside VS Code.
 */
export function containedUvEnv(
	storageRoot: string,
	platform: NodeJS.Platform = process.platform,
): { UV_PYTHON_INSTALL_DIR: string; UV_CACHE_DIR: string } {
	const p = platform === 'win32' ? path.win32 : path.posix;
	return {
		UV_PYTHON_INSTALL_DIR: p.join(storageRoot, 'python'),
		UV_CACHE_DIR: p.join(storageRoot, 'cache'),
	};
}

export type PipFailureKind = 'pep668' | 'no-pip' | 'ssl' | 'network' | 'generic';

/**
 * Classify a pip-install failure from its stderr so the caller can pick actionable guidance:
 * an externally managed Python (PEP 668), a Python without pip, TLS interception (corporate
 * proxy), an unreachable PyPI, or an unrecognized failure.
 */
export function classifyPipFailure(stderr: string): PipFailureKind {
	const s = stderr.toLowerCase();
	if (s.includes('externally-managed-environment')) return 'pep668';
	if (s.includes('no module named pip')) return 'no-pip';
	if (
		s.includes('certificate_verify_failed') ||
		s.includes('sslerror') ||
		s.includes('ssl:') ||
		s.includes('self-signed certificate')
	) {
		return 'ssl';
	}
	if (
		s.includes('proxyerror') ||
		s.includes('could not fetch') ||
		s.includes('timed out') ||
		s.includes('getaddrinfo') ||
		s.includes('connection')
	) {
		return 'network';
	}
	return 'generic';
}

export interface VenvPlan {
	/** True when uv must download a managed Python (no usable system Python exists). */
	managed: boolean;
	/** Args for `uv venv`. */
	venvArgs: string[];
	/** Whether uv may download a Python while creating the venv. */
	downloads: 'never' | 'automatic';
}

/**
 * Decide how to create the venv's interpreter, preferring an existing Python and only downloading
 * a managed one as a last resort:
 *   - an explicitly picked Python  -> pin it, never download
 *   - any system Python is present -> let uv discover it, never download
 *   - no Python at all             -> uv installs and uses a managed Python (download allowed)
 */
export function venvPlan(pickedExe: string | undefined, hasSystemPython: boolean): VenvPlan {
	if (pickedExe) {
		return { managed: false, venvArgs: ['venv', '--python', pickedExe], downloads: 'never' };
	}
	if (hasSystemPython) {
		return { managed: false, venvArgs: ['venv'], downloads: 'never' };
	}
	return { managed: true, venvArgs: ['venv', '--python', '3'], downloads: 'automatic' };
}
