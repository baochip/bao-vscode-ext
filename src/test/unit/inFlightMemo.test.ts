import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InFlightMemo } from '../../util/inFlightMemo';

/** A promise plus its resolve/reject, so a test can settle the factory when it chooses. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

test('InFlightMemo: concurrent callers share one run and all get the same result', async () => {
	const memo = new InFlightMemo<number>();
	let calls = 0;
	const d = deferred<number>();
	const factory = () => {
		calls++;
		return d.promise;
	};

	const a = memo.run(factory);
	const b = memo.run(factory);
	assert.equal(calls, 1, 'the factory started once for concurrent first-run callers');

	d.resolve(42);
	assert.equal(await a, 42);
	assert.equal(await b, 42);
});

test('InFlightMemo: a resolved result is cached and the factory is not re-run', async () => {
	const memo = new InFlightMemo<number>();
	let calls = 0;
	const factory = async () => ++calls;

	assert.equal(await memo.run(factory), 1);
	assert.equal(await memo.run(factory), 1, 'the second call returns the cached result');
	assert.equal(calls, 1, 'the factory ran only once');
});

test('InFlightMemo: a rejected run is cleared so the next call retries', async () => {
	const memo = new InFlightMemo<string>();
	let calls = 0;
	const factory = async () => {
		calls++;
		if (calls === 1) throw new Error('first attempt fails');
		return 'ok';
	};

	await assert.rejects(memo.run(factory), /first attempt fails/);
	assert.equal(await memo.run(factory), 'ok', 'the retry runs and succeeds after the failure');
	assert.equal(calls, 2);
});

test('InFlightMemo: clear() forces the next run to re-invoke the factory', async () => {
	const memo = new InFlightMemo<number>();
	let calls = 0;
	const factory = async () => ++calls;

	assert.equal(await memo.run(factory), 1);
	memo.clear();
	assert.equal(await memo.run(factory), 2, 'a cleared memo re-runs the factory');
});

test('InFlightMemo: settle() waits for an in-flight run to finish before resolving', async () => {
	const memo = new InFlightMemo<number>();
	const d = deferred<number>();
	memo.run(() => d.promise);

	let settled = false;
	const settling = memo.settle().then(() => {
		settled = true;
	});
	await Promise.resolve(); // flush microtasks
	assert.equal(settled, false, 'settle stays pending while the run is in flight');

	d.resolve(1);
	await settling;
	assert.equal(settled, true, 'settle resolves once the in-flight run finished');
});

test('InFlightMemo: settle() clears the cached result so the next run re-invokes the factory', async () => {
	const memo = new InFlightMemo<number>();
	let calls = 0;
	await memo.run(async () => ++calls);
	await memo.settle();
	assert.equal(await memo.run(async () => ++calls), 2, 'factory ran again after settle');
});

test('InFlightMemo: settle() does not reject when the in-flight run fails', async () => {
	const memo = new InFlightMemo<number>();
	memo.run(() => Promise.reject(new Error('boom'))).catch(() => {}); // handle the run rejection
	await assert.doesNotReject(memo.settle());
});

test('InFlightMemo: settle() with no in-flight run resolves immediately and stays usable', async () => {
	const memo = new InFlightMemo<number>();
	await assert.doesNotReject(memo.settle());
	assert.equal(await memo.run(async () => 7), 7);
});
