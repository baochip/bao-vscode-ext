import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shellCd } from '../../util/shell';

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
