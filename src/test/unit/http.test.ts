import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isRedirectHostAllowed } from '../../services/httpService';

test('isRedirectHostAllowed: a public origin may NOT redirect to a loopback address (SSRF guard)', () => {
	for (const host of ['127.0.0.1', 'localhost', '::1']) {
		assert.equal(isRedirectHostAllowed(false, host), false, `public -> ${host} must be refused`);
	}
});

test('isRedirectHostAllowed: a public origin may redirect to another public host', () => {
	// GitHub release assets legitimately redirect cross-host (objects.githubusercontent.com / S3).
	assert.equal(isRedirectHostAllowed(false, 'github.com'), true);
	assert.equal(isRedirectHostAllowed(false, 'objects.githubusercontent.com'), true);
	assert.equal(isRedirectHostAllowed(false, 'ci.betrusted.io'), true);
});

test('isRedirectHostAllowed: a loopback origin (tests) may redirect within loopback', () => {
	assert.equal(isRedirectHostAllowed(true, '127.0.0.1'), true);
	assert.equal(isRedirectHostAllowed(true, 'localhost'), true);
});
