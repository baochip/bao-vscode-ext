import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isLikelyValidAppName } from '../../util/appName';

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
