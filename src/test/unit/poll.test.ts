import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pollUntil } from '../../util/poll';

// Virtual clock: sleep advances `now`, so tests never actually wait.
function base() {
	let t = 0;
	return {
		timeoutMs: 10000,
		intervalMs: 500,
		maxErrors: 3,
		now: () => t,
		sleep: async (ms: number) => {
			t += ms;
		},
	};
}

test('pollUntil: "found" when probe eventually returns true', async () => {
	let calls = 0;
	const r = await pollUntil(async () => ++calls >= 2, base());
	assert.equal(r, 'found');
	assert.equal(calls, 2);
});

test('pollUntil: "timeout" when probe never returns true', async () => {
	const r = await pollUntil(async () => false, { ...base(), timeoutMs: 1000, intervalMs: 500 });
	assert.equal(r, 'timeout');
});

test('pollUntil: "error" after maxErrors consecutive throws', async () => {
	let calls = 0;
	const r = await pollUntil(async () => {
		calls++;
		throw new Error('boom');
	}, base());
	assert.equal(r, 'error');
	assert.equal(calls, 3);
});

test('pollUntil: does not bail on fewer than maxErrors consecutive throws', async () => {
	let calls = 0;
	const r = await pollUntil(async () => {
		calls++;
		if (calls <= 2) throw new Error('transient');
		return true;
	}, base());
	assert.equal(r, 'found');
});

test('pollUntil: resets the error count after a non-throwing probe', async () => {
	// throw, false (reset), throw, throw, throw -> only the last 3 are consecutive
	const seq: (() => boolean)[] = [
		() => {
			throw new Error();
		},
		() => false,
		() => {
			throw new Error();
		},
		() => {
			throw new Error();
		},
		() => {
			throw new Error();
		},
	];
	let i = 0;
	const r = await pollUntil(async () => seq[i++](), base());
	assert.equal(r, 'error');
	assert.equal(i, 5);
});

test('pollUntil: "cancelled" when cancellation is requested', async () => {
	const r = await pollUntil(async () => false, { ...base(), isCancelled: () => true });
	assert.equal(r, 'cancelled');
});

test('pollUntil: a cancel on the final allowed error returns "cancelled", not "error"', async () => {
	// The maxErrors-th probe throws because it was cancelled; that must read as a cancel.
	let calls = 0;
	const r = await pollUntil(
		async () => {
			calls++;
			throw new Error('killed');
		},
		{ ...base(), isCancelled: () => calls >= 3 },
	);
	assert.equal(r, 'cancelled');
	assert.equal(calls, 3);
});
