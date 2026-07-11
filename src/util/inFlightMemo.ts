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

	/**
	 * Wait for any in-flight run to finish (ignoring its outcome), then forget the cached result.
	 * Use before a destructive reset so a concurrent run cannot keep writing while cleanup deletes
	 * the same files. Only clears if the slot was not replaced by a new run while awaiting.
	 */
	async settle(): Promise<void> {
		const pending = this.pending;
		try {
			await pending;
		} catch {}
		if (this.pending === pending) {
			this.pending = undefined;
		}
	}
}
