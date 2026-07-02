import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRustcVersion } from '../../util/rust';

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
