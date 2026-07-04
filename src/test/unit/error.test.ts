import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toMessage } from '../../util/error';

test('toMessage: returns the message of an Error', () => {
	assert.equal(toMessage(new Error('boom')), 'boom');
});

test('toMessage: stringifies non-Error values', () => {
	assert.equal(toMessage('plain string'), 'plain string');
	assert.equal(toMessage(42), '42');
	assert.equal(toMessage(undefined), 'undefined');
	assert.equal(toMessage(null), 'null');
});

test('toMessage: uses message (not name) for Error subclasses', () => {
	assert.equal(toMessage(new RangeError('out of range')), 'out of range');
});
