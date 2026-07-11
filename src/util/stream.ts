import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream';

/**
 * Write a readable stream to `dest` atomically: bytes go to a `.partial` temp file in the same
 * directory, renamed onto `dest` only after the stream completes. On any failure (source error,
 * premature close, file error) the temp file is removed and `dest` is left as it was - a
 * previous good file survives, and a truncated transfer never lands at `dest`. Always settles.
 */
export function writeStreamToFile(source: Readable, dest: string): Promise<void> {
	// Unique temp name (pid + random) so concurrent transfers to the same dest - e.g. two VS Code
	// windows downloading kernel files into the shared cache - never share one .partial file and
	// corrupt each other. Kept in dest's directory so the final rename stays atomic (same volume).
	const tmp = `${dest}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.partial`;
	return new Promise((resolve, reject) => {
		const file = fs.createWriteStream(tmp);
		pipeline(source, file, (err) => {
			if (err) {
				try {
					fs.unlinkSync(tmp);
				} catch {}
				return reject(err);
			}
			try {
				fs.renameSync(tmp, dest);
				resolve();
			} catch (renameErr) {
				try {
					fs.unlinkSync(tmp);
				} catch {}
				reject(renameErr);
			}
		});
	});
}
