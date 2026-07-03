import * as fs from 'node:fs';
import * as path from 'node:path';

/** True if path exists and is a directory. Returns false (rather than throwing) if it does not exist. */
export function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

/** True if path exists and is a regular file. Returns false (rather than throwing) if it does not exist. */
export function isFile(p: string): boolean {
	try {
		return fs.statSync(p).isFile();
	} catch {
		return false;
	}
}

/**
 * Resolve to a canonical absolute path (realpath when the path exists), lower-cased on Windows so
 * comparisons are case-insensitive there. Falls back to path.resolve when the path does not exist.
 */
export function realPath(p: string): string {
	const abs = path.resolve(p);
	try {
		const realpathSync = fs.realpathSync as typeof fs.realpathSync & {
			native?: (p: string) => string;
		};
		const rp = realpathSync.native ? realpathSync.native(abs) : realpathSync(abs);
		return process.platform === 'win32' ? rp.toLowerCase() : rp;
	} catch {
		return process.platform === 'win32' ? abs.toLowerCase() : abs;
	}
}

/** True if `child` is the same path as `parent` or nested under it (realpath- and case-aware). */
export function isSameOrParentPath(parent: string, child: string): boolean {
	const a = realPath(parent);
	const b = realPath(child);
	if (a === b) return true;
	const aSep = a.endsWith(path.sep) ? a : a + path.sep;
	return b.startsWith(aSep);
}
