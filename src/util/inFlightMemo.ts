/**
 * Shares one in-flight promise among concurrent callers: the first `run` starts the work, later
 * callers that arrive before it settles receive the same promise. A resolved result stays cached
 * (the fast path for subsequent calls); a rejected one is cleared so the next call retries.
 * `clear` forgets any cached result.
 */
export class InFlightMemo<T> {
	private pending: Promise<T> | undefined;

	run(factory: () => Promise<T>): Promise<T> {
		this.pending ??= factory().catch((e) => {
			this.pending = undefined; // don't cache a failed run
			throw e;
		});
		return this.pending;
	}

	clear(): void {
		this.pending = undefined;
	}
}
