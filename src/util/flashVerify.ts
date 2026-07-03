export type VerifyResult =
	| { ok: true; by: 'md5' | 'size' }
	| { ok: false; reason: 'unreadable' }
	| { ok: false; reason: 'size-mismatch'; wrote: number; expected: number };

/**
 * Classify a post-write flash verification from the source hash/size and whatever could be read
 * back from the destination. `dstMd5`/`dstSize` are undefined when the destination could not be
 * hashed/stat'd. Prefers a content-hash match, falling back to byte length (some UF2 drives do not
 * return the written bytes on read).
 */
export function classifyWriteVerification(
	srcMd5: string,
	dstMd5: string | undefined,
	srcSize: number,
	dstSize: number | undefined,
): VerifyResult {
	if (dstMd5 === srcMd5) return { ok: true, by: 'md5' };
	if (dstSize === undefined) return { ok: false, reason: 'unreadable' };
	if (dstSize !== srcSize)
		return { ok: false, reason: 'size-mismatch', wrote: dstSize, expected: srcSize };
	return { ok: true, by: 'size' };
}
