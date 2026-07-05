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

test('writeStreamToFile: writes the full content and leaves no temp file', async () => {
	const { dir, dest } = makeDest();
	try {
		const src = new PassThrough();
		const done = writeStreamToFile(src, dest);
		src.write('hello ');
		src.end('bytes');
		await done;

		assert.equal(fs.readFileSync(dest, 'utf8'), 'hello bytes');
		assert.equal(fs.existsSync(`${dest}.partial`), false, 'temp file renamed away');
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
		assert.equal(fs.existsSync(`${dest}.partial`), false, 'no partial file left behind');
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
		assert.equal(fs.existsSync(`${dest}.partial`), false, 'no partial file');
	} finally {
		cleanup(dir);
	}
});
