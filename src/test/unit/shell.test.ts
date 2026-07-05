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

test('quoteArg: leaves shell-safe tokens unquoted on both platforms', () => {
	for (const token of ['COM7', 'dabao', '--no-echo', '1000000', 'target/riscv/release/app']) {
		assert.equal(quoteArg(token, 'win32'), token);
		assert.equal(quoteArg(token, 'linux'), token);
	}
});

test('quoteArg: win32 double-quotes a value containing whitespace', () => {
	assert.equal(quoteArg('/path/with a space', 'win32'), '"/path/with a space"');
});

test('quoteArg: win32 escapes embedded double quotes', () => {
	assert.equal(quoteArg('say "hi"', 'win32'), '"say \\"hi\\""');
});

test('quoteArg: posix single-quotes so metacharacters stay inert', () => {
	assert.equal(quoteArg('/path/with a space', 'linux'), "'/path/with a space'");
	assert.equal(quoteArg('foo;rm -rf ~', 'linux'), "'foo;rm -rf ~'");
	assert.equal(quoteArg('$(evil)', 'darwin'), "'$(evil)'");
	assert.equal(quoteArg('a`b', 'linux'), "'a`b'");
});

test('quoteArg: posix escapes embedded single quotes', () => {
	assert.equal(quoteArg("it's here", 'linux'), "'it'\\''s here'");
});

test('quoteArg: quotes shell metacharacters on win32 too', () => {
	assert.equal(quoteArg('foo;bar', 'win32'), '"foo;bar"');
	assert.equal(quoteArg('a|b&c', 'win32'), '"a|b&c"');
});

test('quoteArg: quotes the empty string', () => {
	assert.equal(quoteArg('', 'win32'), '""');
	assert.equal(quoteArg('', 'linux'), "''");
});

test('quoteArg: defaults platform to the current process', () => {
	const expected = process.platform === 'win32' ? '"a b"' : "'a b'";
	assert.equal(quoteArg('a b'), expected);
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
