import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyWriteVerification } from '../../util/flashVerify';

test('classifyWriteVerification: matching hash verifies by md5', () => {
	assert.deepEqual(classifyWriteVerification('abc123', 'abc123', 100, 100), {
		ok: true,
		by: 'md5',
	});
});

test('classifyWriteVerification: hash mismatch but matching size falls back to size (e.g. virtual drive)', () => {
	assert.deepEqual(classifyWriteVerification('abc123', 'different', 100, 100), {
		ok: true,
		by: 'size',
	});
});

test('classifyWriteVerification: unreadable hash but matching size verifies by size', () => {
	assert.deepEqual(classifyWriteVerification('abc123', undefined, 100, 100), {
		ok: true,
		by: 'size',
	});
});

test('classifyWriteVerification: size mismatch fails with wrote/expected', () => {
	assert.deepEqual(classifyWriteVerification('abc123', 'different', 100, 40), {
		ok: false,
		reason: 'size-mismatch',
		wrote: 40,
		expected: 100,
	});
});

test('classifyWriteVerification: neither hash nor size readable fails as unreadable', () => {
	assert.deepEqual(classifyWriteVerification('abc123', undefined, 100, undefined), {
		ok: false,
		reason: 'unreadable',
	});
});
