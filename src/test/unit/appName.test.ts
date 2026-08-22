import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLikelyValidAppName, splitAppNames } from '../../util/appName';

test('isLikelyValidAppName: accepts lowercase names starting with a letter', () => {
	for (const name of ['app', 'test_app', 'my-app', 'a1', 'x_2-y']) {
		assert.equal(isLikelyValidAppName(name), true, name);
	}
});

test('isLikelyValidAppName: rejects names not starting with a lowercase letter', () => {
	for (const name of ['1app', '_app', '-app', 'App', 'ZZ']) {
		assert.equal(isLikelyValidAppName(name), false, name);
	}
});

test('isLikelyValidAppName: rejects empty and illegal characters', () => {
	for (const name of ['', 'my app', 'app!', 'app.name', 'app/name', 'café']) {
		assert.equal(isLikelyValidAppName(name), false, name);
	}
});

test('splitAppNames: splits on any run of whitespace', () => {
	assert.deepEqual(splitAppNames('alpha  zeta\tbeta'), ['alpha', 'zeta', 'beta']);
});

test('splitAppNames: trims and ignores empty input', () => {
	assert.deepEqual(splitAppNames('  hello  '), ['hello']);
	assert.deepEqual(splitAppNames(''), []);
	assert.deepEqual(splitAppNames('   '), []);
	assert.deepEqual(splitAppNames(undefined), []);
});

test('splitAppNames: keeps a region suffix intact', () => {
	assert.deepEqual(splitAppNames('dc34-console~flash dc34-vault'), [
		'dc34-console~flash',
		'dc34-vault',
	]);
});

test('isLikelyValidAppName: accepts an xtask memory region suffix', () => {
	assert.equal(isLikelyValidAppName('dc34-console~flash'), true);
	assert.equal(isLikelyValidAppName('my_app~swap'), true);
	assert.equal(isLikelyValidAppName('my_app~ram'), true);
});

test('isLikelyValidAppName: rejects an unknown region and a bare tilde', () => {
	assert.equal(isLikelyValidAppName('dc34-console~elsewhere'), false);
	assert.equal(isLikelyValidAppName('dc34-console~'), false);
	assert.equal(isLikelyValidAppName('~flash'), false);
});
