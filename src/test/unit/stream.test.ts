import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { writeStreamToFile } from '../../util/stream';

function makeDest(): { dir: string; dest: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bao-stream-'));
	return { dir, dest: path.join(dir, 'out.bin') };
}

function cleanup(dir: string): void {
	try {
		fs.rmSync(dir, { recursive: true, force: true });
	} catch {}
}

/** Names of any leftover `.partial` temp files in `dir` (the temp name now carries a unique suffix). */
function partialFiles(dir: string): string[] {
	return fs.readdirSync(dir).filter((f) => f.includes('.partial'));
}

test('writeStreamToFile: writes the full content and leaves no temp file', async () => {
	const { dir, dest } = makeDest();
	try {
		const src = new PassThrough();
		const done = writeStreamToFile(src, dest);
		src.write('hello ');
		src.end('bytes');
		await done;

		assert.equal(fs.readFileSync(dest, 'utf8'), 'hello bytes');
		assert.deepEqual(partialFiles(dir), [], 'temp file renamed away');
	} finally {
		cleanup(dir);
	}
});

test('writeStreamToFile: replaces an existing destination on success', async () => {
	const { dir, dest } = makeDest();
	try {
		fs.writeFileSync(dest, 'old content');
		const src = new PassThrough();
		const done = writeStreamToFile(src, dest);
		src.end('new content');
		await done;

		assert.equal(fs.readFileSync(dest, 'utf8'), 'new content');
	} finally {
		cleanup(dir);
	}
});

test('writeStreamToFile: a source error rejects, cleans the temp file, and preserves the old destination', async () => {
	const { dir, dest } = makeDest();
	try {
		fs.writeFileSync(dest, 'previous good download');
		const src = new PassThrough();
		const done = writeStreamToFile(src, dest);
		src.write('trunc');
		src.destroy(new Error('connection reset'));

		await assert.rejects(done, /connection reset/);
		assert.equal(fs.readFileSync(dest, 'utf8'), 'previous good download', 'old file untouched');
		assert.deepEqual(partialFiles(dir), [], 'no partial file left behind');
	} finally {
		cleanup(dir);
	}
});

test('writeStreamToFile: a premature close (no error object) still rejects and leaves nothing', async () => {
	const { dir, dest } = makeDest();
	try {
		const src = new PassThrough();
		const done = writeStreamToFile(src, dest);
		src.write('half a download');
		src.destroy();

		await assert.rejects(done);
		assert.equal(fs.existsSync(dest), false, 'no destination file');
		assert.deepEqual(partialFiles(dir), [], 'no partial file');
	} finally {
		cleanup(dir);
	}
});

test('writeStreamToFile: concurrent writes to the same dest do not collide', async () => {
	const { dir, dest } = makeDest();
	try {
		const a = new PassThrough();
		const b = new PassThrough();
		const doneA = writeStreamToFile(a, dest);
		const doneB = writeStreamToFile(b, dest);
		a.end('a'.repeat(2000));
		b.end('b'.repeat(2000));
		await Promise.all([doneA, doneB]);

		// Each write used its own temp file, so dest is exactly one clean copy - not interleaved.
		const content = fs.readFileSync(dest, 'utf8');
		assert.ok(
			content === 'a'.repeat(2000) || content === 'b'.repeat(2000),
			'dest is one intact copy, not a corrupted mix',
		);
		assert.deepEqual(partialFiles(dir), [], 'both temp files cleaned up');
	} finally {
		cleanup(dir);
	}
});
