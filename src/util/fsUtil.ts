import * as fs from 'node:fs';

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
