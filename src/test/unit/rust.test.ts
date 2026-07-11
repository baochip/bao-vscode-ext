import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRustcVersion, pickHighestPatchIndex } from '../../util/rust';

test('parseRustcVersion: reads a standard version line', () => {
	assert.equal(parseRustcVersion('rustc 1.87.0 (17067e9ac 2025-05-09)'), '1.87.0');
});

test('parseRustcVersion: reads a nightly version (stops before the channel suffix)', () => {
	assert.equal(parseRustcVersion('rustc 1.90.0-nightly (abc1234 2025-06-01)'), '1.90.0');
});

test('parseRustcVersion: returns null for empty or unrecognized output', () => {
	assert.equal(parseRustcVersion(''), null);
	assert.equal(parseRustcVersion("'rustc' is not recognized as a command"), null);
});

test('pickHighestPatchIndex: picks the highest patch from a newest-first list', () => {
	assert.equal(pickHighestPatchIndex(['1.87.0.2', '1.87.0.1'], '1.87.0'), 0);
});

test('pickHighestPatchIndex: picks the highest patch regardless of list order', () => {
	assert.equal(pickHighestPatchIndex(['1.87.0.1', '1.87.0.2'], '1.87.0'), 1);
	assert.equal(pickHighestPatchIndex(['1.87.0.1', '1.87.0.10', '1.87.0.9'], '1.87.0'), 1);
});

test('pickHighestPatchIndex: a bare version tag counts as patch 0', () => {
	assert.equal(pickHighestPatchIndex(['1.87.0', '1.87.0.1'], '1.87.0'), 1);
	assert.equal(pickHighestPatchIndex(['1.87.0'], '1.87.0'), 0);
});

test('pickHighestPatchIndex: unparsable suffixes rank lowest; all-unparsable keeps the newest', () => {
	assert.equal(pickHighestPatchIndex(['1.87.0-rc1', '1.87.0.1'], '1.87.0'), 1);
	assert.equal(pickHighestPatchIndex(['1.87.0-beta', '1.87.0x'], '1.87.0'), 0);
});
