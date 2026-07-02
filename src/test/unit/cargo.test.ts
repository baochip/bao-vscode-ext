import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOutOfTreeFeatures, parseCargoPackageName } from '../../util/cargo';

test('parseCargoPackageName: reads a normal package name', () => {
	assert.equal(parseCargoPackageName('[package]\nname = "my_app"\nversion = "0.1.0"\n'), 'my_app');
});

test('parseCargoPackageName: tolerates extra whitespace around =', () => {
	assert.equal(parseCargoPackageName('name   =   "spaced"'), 'spaced');
});

test('parseCargoPackageName: returns null when there is no name field', () => {
	assert.equal(parseCargoPackageName('[package]\nversion = "0.1.0"\n'), null);
});

test('parseCargoPackageName: only matches a name at the start of a line', () => {
	// indented keys (e.g. a dependency table) are skipped; the top-level name wins
	const toml = '[dependencies]\n  name = "not-this"\n[package]\nname = "real_app"\n';
	assert.equal(parseCargoPackageName(toml), 'real_app');
});

const FIXED = ['--features', 'bao1x', '--features', 'utralib/bao1x'];

test('buildOutOfTreeFeatures: defaults to board-dabao with the fixed features', () => {
	assert.deepEqual(buildOutOfTreeFeatures('', []), ['--features', 'board-dabao', ...FIXED]);
});

test('buildOutOfTreeFeatures: uses the given board target', () => {
	assert.deepEqual(buildOutOfTreeFeatures('baosec', []), ['--features', 'board-baosec', ...FIXED]);
});

test('buildOutOfTreeFeatures: appends each extra feature as its own --features flag', () => {
	assert.deepEqual(buildOutOfTreeFeatures('dabao', ['foo', 'bar']), [
		'--features',
		'board-dabao',
		...FIXED,
		'--features',
		'foo',
		'--features',
		'bar',
	]);
});
