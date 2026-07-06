import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { describeRunFailure, runProcess } from '../../services/procService';

const emptyResult = { stdout: '', stderr: '', cancelled: false };

/** A minimal CancellationToken (the real vscode type is not available in the tsx unit runner). */
function fakeToken() {
	const emitter = new EventEmitter();
	return {
		token: {
			isCancellationRequested: false,
			onCancellationRequested: (cb: () => void) => {
				emitter.on('cancel', cb);
				return { dispose: () => emitter.off('cancel', cb) };
			},
		} as unknown as import('vscode').CancellationToken,
		cancel() {
			(this.token as { isCancellationRequested: boolean }).isCancellationRequested = true;
			emitter.emit('cancel');
		},
	};
}

test('runProcess: captures stdout and a zero exit code', async () => {
	const r = await runProcess(process.execPath, ['-e', 'process.stdout.write("hi")']);
	assert.equal(r.code, 0);
	assert.equal(r.stdout, 'hi');
	assert.equal(r.cancelled, false);
	assert.equal(r.error, undefined);
});

test('runProcess: reports a nonzero exit code', async () => {
	const r = await runProcess(process.execPath, ['-e', 'process.exit(3)']);
	assert.equal(r.code, 3);
	assert.equal(r.cancelled, false);
});

test('runProcess: decodes multibyte UTF-8 output split across stream chunks', async () => {
	// 300 KB of 3-byte characters far exceeds the ~64 KB stream chunk size, so boundaries land
	// mid-character; a naive per-chunk toString() would emit replacement chars there.
	const expected = 'あ'.repeat(100000);
	const r = await runProcess(process.execPath, [
		'-e',
		'process.stdout.write("\\u3042".repeat(100000))',
	]);
	assert.equal(r.code, 0);
	assert.equal(r.stdout, expected, 'no mojibake at chunk boundaries');
});

test('runProcess: returns an error result for a missing executable', async () => {
	const r = await runProcess('definitely-not-a-real-binary-xyz', []);
	assert.ok(r.error, 'error surfaced instead of hanging');
	assert.equal(r.code, null);
});

test('describeRunFailure: prefers stderr, then stdout, over the exit code', async () => {
	assert.equal(describeRunFailure({ ...emptyResult, code: 1, stderr: '  boom  ' }), 'boom');
	assert.equal(describeRunFailure({ ...emptyResult, code: 1, stdout: 'note' }), 'note');
});

test('describeRunFailure: reports the signal for a signal-killed child, not "exited null"', async () => {
	assert.equal(
		describeRunFailure({ ...emptyResult, code: null, signal: 'SIGKILL' }),
		'terminated by signal SIGKILL',
	);
});

test('describeRunFailure: falls back to the exit code when there is nothing else', async () => {
	assert.equal(describeRunFailure({ ...emptyResult, code: 2 }), 'exited 2');
});

test('describeRunFailure: surfaces a spawn error message first', async () => {
	assert.equal(
		describeRunFailure({ ...emptyResult, code: null, error: new Error('spawn ENOENT') }),
		'spawn ENOENT',
	);
});

test('runProcess: cancelling the token kills the process and marks the result cancelled', async () => {
	const t = fakeToken();
	// A process that would otherwise run for 30s; cancellation must settle it promptly.
	const started = Date.now();
	const p = runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { token: t.token });
	setTimeout(() => t.cancel(), 50);

	const r = await p;

	assert.equal(r.cancelled, true, 'result flagged cancelled');
	assert.ok(Date.now() - started < 10000, 'settled promptly, not after the 30s runtime');
});
