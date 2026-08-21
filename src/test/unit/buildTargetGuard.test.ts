import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { DEFAULT_BUILD_TARGET } from '../../constants';

// Static guards for the hardware target: nothing quietly assumes a board, and the setting is
// reached only through configService's accessors.

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC_DIR = path.join(ROOT, 'src');

/** Files allowed to name the setting key, relative to src. */
const SETTING_KEY_ALLOWED = [path.join('services', 'configService.ts')];

function listSourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (full === path.join(SRC_DIR, 'test')) continue; // the guards themselves name these
			files.push(...listSourceFiles(full));
		} else if (entry.name.endsWith('.ts')) {
			files.push(full);
		}
	}
	return files;
}

/** Source files matching a pattern, as paths relative to src. */
function srcFilesMatching(pattern: RegExp): string[] {
	return listSourceFiles(SRC_DIR)
		.filter((file) => pattern.test(fs.readFileSync(file, 'utf8')))
		.map((file) => path.relative(SRC_DIR, file))
		.sort();
}

test('hardware target: no code falls back to a board of its own choosing', () => {
	// A silent default: `|| 'dabao'` or `?? 'dabao'`. The user picks instead, once.
	const fallback = new RegExp(`[|?]{2}[ ]*['"]${DEFAULT_BUILD_TARGET}`);
	assert.deepEqual(
		srcFilesMatching(fallback),
		[],
		`files assuming "${DEFAULT_BUILD_TARGET}" instead of calling ensureBuildTarget()`,
	);
});

test('hardware target: only configService names the setting key', () => {
	const found = srcFilesMatching(/['"]buildTarget['"]/);
	assert.deepEqual(found, [...SETTING_KEY_ALLOWED].sort(), 'files reaching past the accessors');
});
