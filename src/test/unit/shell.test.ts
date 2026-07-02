import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quoteArg, shellCd } from '../../util/shell';

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
