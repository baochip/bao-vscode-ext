import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFullPathCommand, quoteArg, shellCd } from '../../util/shell';

test('shellCd: win32 wraps the path in double quotes', () => {
	assert.equal(shellCd('C:\\Program Files\\bao', 'win32'), 'cd "C:\\Program Files\\bao"');
});

test('shellCd: posix single-quotes the path', () => {
	assert.equal(shellCd('/home/jeanie/xous core', 'linux'), "cd '/home/jeanie/xous core'");
});

test('shellCd: posix escapes embedded single quotes', () => {
	assert.equal(shellCd("/tmp/it's here", 'darwin'), "cd '/tmp/it'\\''s here'");
});

test('shellCd: defaults platform to the current process', () => {
	const expected = process.platform === 'win32' ? 'cd "/x/y"' : "cd '/x/y'";
	assert.equal(shellCd('/x/y'), expected);
});

test('quoteArg: leaves a plain token unquoted', () => {
	assert.equal(quoteArg('COM7'), 'COM7');
});

test('quoteArg: double-quotes a value containing whitespace', () => {
	assert.equal(quoteArg('/path/with a space'), '"/path/with a space"');
});

test('quoteArg: escapes embedded double quotes', () => {
	assert.equal(quoteArg('say "hi"'), '"say \\"hi\\""');
});

test('quoteArg: quotes values containing a backtick', () => {
	assert.equal(quoteArg('a`b'), '"a`b"');
});

test('isFullPathCommand: bare command names are not full paths (need a shell)', () => {
	for (const name of ['uv', 'uv.exe', 'py -3', 'python3', 'python']) {
		assert.equal(isFullPathCommand(name), false, name);
	}
});

test('isFullPathCommand: Windows full paths are full paths (incl. spaces)', () => {
	assert.equal(isFullPathCommand('C:\\Program Files\\Git\\cmd\\git.exe'), true);
	assert.equal(
		isFullPathCommand(
			'C:\\Users\\First Last\\AppData\\Roaming\\Python\\Python312\\Scripts\\uv.exe',
		),
		true,
	);
});

test('isFullPathCommand: POSIX full paths are full paths', () => {
	assert.equal(isFullPathCommand('/home/user/.local/bin/uv'), true);
	assert.equal(isFullPathCommand('/usr/bin/python3'), true);
});
