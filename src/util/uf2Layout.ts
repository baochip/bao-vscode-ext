const KB = 1024;
const MB = 1024 * 1024;

/** Byte count for display: MB from 1 MB up, KB from 1 KB up, whole bytes below. 1024-based. */
export function formatBytes(bytes: number): string {
	if (bytes >= MB) return `${(bytes / MB).toFixed(2)} MB`;
	if (bytes >= KB) return `${(bytes / KB).toFixed(1)} KB`;
	return `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}`;
}

export const UF2_BLOCK_BYTES = 512;
export const UF2_PAYLOAD_BYTES = 256;
export const BAOCHIP_UF2_FAMILY = 0xa7d7_6373;

const UF2_MAGIC_START0 = 0x0a32_4655;
const UF2_MAGIC_START1 = 0x9e5d_5157;
const UF2_MAGIC_END = 0x0ab1_6f30;
const UF2_FLAG_FAMILY_ID = 0x2000;

export type Uf2Region = 'loader' | 'kernel' | 'app';

// Bounds from xous-core libs/bao1x-api/src/offsets/{common,dabao}.rs, with SIGBLOCK_LEN of 768.
const DABAO_REGIONS: Array<{ region: Uf2Region; start: number; end: number }> = [
	{ region: 'loader', start: 0x6006_0000, end: 0x6009_fd00 },
	{ region: 'kernel', start: 0x6009_fd00, end: 0x602f_fd00 },
	{ region: 'app', start: 0x602f_fd00, end: 0x603d_a000 },
];

export type Uf2Header = { targetAddr: number; familyId: number };

/** Read the target address and family from a .uf2 file's first block, or null if it is not one. */
export function parseUf2FirstBlock(head: Buffer): Uf2Header | null {
	if (head.length < UF2_BLOCK_BYTES) return null;
	if (
		head.readUInt32LE(0) !== UF2_MAGIC_START0 ||
		head.readUInt32LE(4) !== UF2_MAGIC_START1 ||
		head.readUInt32LE(508) !== UF2_MAGIC_END
	) {
		return null;
	}
	const flags = head.readUInt32LE(8);
	return {
		targetAddr: head.readUInt32LE(12),
		familyId: (flags & UF2_FLAG_FAMILY_ID) === 0 ? 0 : head.readUInt32LE(28),
	};
}

export type Uf2Fit =
	| { kind: 'unknown' }
	| { kind: 'ok'; region: Uf2Region; size: number; limit: number }
	| { kind: 'over'; region: Uf2Region; size: number; limit: number; over: number };

/**
 * Compare a .uf2 file size against the room left in the dabao region its first block targets.
 * Limits are in .uf2 bytes: each 512-byte block carries 256 bytes of payload.
 */
export function classifyUf2Fit(targetAddr: number, fileSize: number): Uf2Fit {
	const match = DABAO_REGIONS.find((r) => targetAddr >= r.start && targetAddr < r.end);
	if (!match) return { kind: 'unknown' };

	const limit = ((match.end - targetAddr) * UF2_BLOCK_BYTES) / UF2_PAYLOAD_BYTES;
	if (fileSize > limit) {
		return { kind: 'over', region: match.region, size: fileSize, limit, over: fileSize - limit };
	}
	return { kind: 'ok', region: match.region, size: fileSize, limit };
}
