export type PollResult = 'found' | 'timeout' | 'cancelled' | 'error';

export interface PollOptions {
	timeoutMs: number;
	intervalMs: number;
	/** Give up after this many consecutive probe errors. */
	maxErrors: number;
	now: () => number;
	sleep: (ms: number) => Promise<void>;
	isCancelled?: () => boolean;
}

/**
 * Poll `probe` until it returns true ('found'), the timeout elapses ('timeout'),
 * cancellation is requested ('cancelled'), or it throws `maxErrors` times in a row ('error').
 * The consecutive-error count resets whenever a probe completes without throwing.
 */
export async function pollUntil(
	probe: () => Promise<boolean>,
	opts: PollOptions,
): Promise<PollResult> {
	const start = opts.now();
	let consecutiveErrors = 0;
	while (opts.now() - start < opts.timeoutMs) {
		if (opts.isCancelled?.()) return 'cancelled';
		try {
			if (await probe()) return 'found';
			consecutiveErrors = 0;
		} catch {
			// A probe that threw because it was cancelled is a cancel, not a failure - check before
			// counting it, so a cancel on the final allowed error is not reported as 'error'.
			if (opts.isCancelled?.()) return 'cancelled';
			if (++consecutiveErrors >= opts.maxErrors) return 'error';
		}
		await opts.sleep(opts.intervalMs);
	}
	return 'timeout';
}
