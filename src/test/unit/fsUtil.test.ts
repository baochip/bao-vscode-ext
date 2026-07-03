import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import { isDirectory, isFile } from '../../util/fsUtil';

let tmpDir: string;
let filePath: string;
let subDir: string;

before(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bao-fsutil-'));
	filePath = path.join(tmpDir, 'a-file.txt');
	fs.writeFileSync(filePath, 'hello');
	subDir = path.join(tmpDir, 'a-dir');
	fs.mkdirSync(subDir);
});

after(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('isDirectory: true for an existing directory', () => {
	assert.equal(isDirectory(subDir), true);
});

test('isDirectory: false for a regular file', () => {
	assert.equal(isDirectory(filePath), false);
});

test('isDirectory: false for a path that does not exist', () => {
	assert.equal(isDirectory(path.join(tmpDir, 'nope')), false);
});

test('isFile: true for an existing regular file', () => {
	assert.equal(isFile(filePath), true);
});

test('isFile: false for a directory', () => {
	assert.equal(isFile(subDir), false);
});

test('isFile: false for a path that does not exist', () => {
	assert.equal(isFile(path.join(tmpDir, 'nope')), false);
});
