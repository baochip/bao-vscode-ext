import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, test } from 'node:test';
import { isDirectory, isFile, isSameOrParentPath } from '../../util/fsUtil';

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

// Non-existent paths so both sides use the path.resolve fallback (deterministic across platforms).
const base = path.join(os.tmpdir(), 'bao-samepath-none');
const nested = path.join(base, 'sub', 'deeper');
const sibling = path.join(os.tmpdir(), 'bao-samepath-noneX');

test('isSameOrParentPath: true for identical paths', () => {
	assert.equal(isSameOrParentPath(base, base), true);
});

test('isSameOrParentPath: true when child is nested under parent', () => {
	assert.equal(isSameOrParentPath(base, nested), true);
});

test('isSameOrParentPath: false when the roles are reversed (child is not a parent)', () => {
	assert.equal(isSameOrParentPath(nested, base), false);
});

test('isSameOrParentPath: false for a prefix sibling that is not a real path segment', () => {
	// "...none" vs "...noneX" share a string prefix but not a path boundary
	assert.equal(isSameOrParentPath(base, sibling), false);
});

test('isSameOrParentPath: false for unrelated paths', () => {
	assert.equal(isSameOrParentPath(base, path.join(os.tmpdir(), 'elsewhere')), false);
});
