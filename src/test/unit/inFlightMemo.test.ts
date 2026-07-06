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
