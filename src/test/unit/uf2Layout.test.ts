import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	BAOCHIP_UF2_FAMILY,
	classifyUf2Fit,
	formatBytes,
	parseUf2FirstBlock,
} from '../../util/uf2Layout';

const LOADER_START = 0x6006_0000;
const KERNEL_START = 0x6009_fd00;
const APP_START = 0x602f_fd00;

const APP_LIMIT = 1787392;
const KERNEL_LIMIT = 4980736;
const LOADER_LIMIT = 522752;

function uf2Block(targetAddr: number, familyId = BAOCHIP_UF2_FAMILY, flags = 0x2000): Buffer {
	const b = Buffer.alloc(512);
	b.writeUInt32LE(0x0a32_4655, 0);
	b.writeUInt32LE(0x9e5d_5157, 4);
	b.writeUInt32LE(flags, 8);
	b.writeUInt32LE(targetAddr, 12);
	b.writeUInt32LE(256, 16);
	b.writeUInt32LE(0, 20);
	b.writeUInt32LE(1, 24);
	b.writeUInt32LE(familyId, 28);
	b.writeUInt32LE(0x0ab1_6f30, 508);
	return b;
}

test('formatBytes: below 1 KB renders as whole bytes', () => {
	assert.equal(formatBytes(0), '0 bytes');
	assert.equal(formatBytes(512), '512 bytes');
	assert.equal(formatBytes(1023), '1023 bytes');
});

test('formatBytes: a single byte is singular', () => {
	assert.equal(formatBytes(1), '1 byte');
});

test('formatBytes: from 1 KB up renders as KB with one decimal', () => {
	assert.equal(formatBytes(1024), '1.0 KB');
	assert.equal(formatBytes(3072), '3.0 KB');
	assert.equal(formatBytes(112640), '110.0 KB');
});

test('formatBytes: from 1 MB up renders as MB with two decimals', () => {
	assert.equal(formatBytes(1024 * 1024), '1.00 MB');
	assert.equal(formatBytes(1212928), '1.16 MB');
	assert.equal(formatBytes(APP_LIMIT), '1.70 MB');
});

test('parseUf2FirstBlock: reads the target address and family from a valid block', () => {
	assert.deepEqual(parseUf2FirstBlock(uf2Block(APP_START)), {
		targetAddr: APP_START,
		familyId: BAOCHIP_UF2_FAMILY,
	});
});

test('parseUf2FirstBlock: the family field is ignored unless the flag marks it present', () => {
	// Without 0x2000 the same field holds the file size, which must not be read as a family id.
	assert.deepEqual(parseUf2FirstBlock(uf2Block(APP_START, BAOCHIP_UF2_FAMILY, 0)), {
		targetAddr: APP_START,
		familyId: 0,
	});
});

test('parseUf2FirstBlock: rejects a block whose magics do not match', () => {
	const badStart0 = uf2Block(APP_START);
	badStart0.writeUInt32LE(0xdead_beef, 0);
	assert.equal(parseUf2FirstBlock(badStart0), null);

	const badStart1 = uf2Block(APP_START);
	badStart1.writeUInt32LE(0xdead_beef, 4);
	assert.equal(parseUf2FirstBlock(badStart1), null);

	const badEnd = uf2Block(APP_START);
	badEnd.writeUInt32LE(0xdead_beef, 508);
	assert.equal(parseUf2FirstBlock(badEnd), null);
});

test('parseUf2FirstBlock: rejects a buffer shorter than one block', () => {
	assert.equal(parseUf2FirstBlock(uf2Block(APP_START).subarray(0, 511)), null);
	assert.equal(parseUf2FirstBlock(Buffer.alloc(0)), null);
});

test('classifyUf2Fit: a file exactly filling the app region fits', () => {
	assert.deepEqual(classifyUf2Fit(APP_START, APP_LIMIT), {
		kind: 'ok',
		region: 'app',
		size: APP_LIMIT,
		limit: APP_LIMIT,
	});
});

test('classifyUf2Fit: one block past the app region is over by 512 bytes', () => {
	assert.deepEqual(classifyUf2Fit(APP_START, APP_LIMIT + 512), {
		kind: 'over',
		region: 'app',
		size: APP_LIMIT + 512,
		limit: APP_LIMIT,
		over: 512,
	});
});

test('classifyUf2Fit: the kernel and loader regions carry their own limits', () => {
	const kernel = classifyUf2Fit(KERNEL_START, 1024);
	assert.deepEqual(kernel, { kind: 'ok', region: 'kernel', size: 1024, limit: KERNEL_LIMIT });

	const loader = classifyUf2Fit(LOADER_START, 1024);
	assert.deepEqual(loader, { kind: 'ok', region: 'loader', size: 1024, limit: LOADER_LIMIT });
});

test('classifyUf2Fit: an address in no known region is unknown rather than over', () => {
	// Swap (dabao has no external RAM) and the boot0 partition below the loader.
	assert.deepEqual(classifyUf2Fit(0x7000_0000, 99_000_000), { kind: 'unknown' });
	assert.deepEqual(classifyUf2Fit(0x6000_0000, 99_000_000), { kind: 'unknown' });
});

test('classifyUf2Fit: the limit is measured from the start address, not the region start', () => {
	const fit = classifyUf2Fit(APP_START + 0x1000, 1024);
	assert.equal(fit.kind === 'ok' && fit.limit, APP_LIMIT - 0x1000 * 2);
});
