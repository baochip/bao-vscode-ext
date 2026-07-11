import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

// Static guards for the manifest localization files: every %key% referenced in package.json
// must exist in package.nls.json, every locale file must carry the same key set as the base,
// and the base must not carry keys package.json no longer references.

const ROOT = path.resolve(__dirname, '..', '..', '..');

function readJson(name: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
}

function nlsLocaleFiles(): string[] {
	return fs
		.readdirSync(ROOT)
		.filter((f) => /^package\.nls\.[\w-]+\.json$/.test(f))
		.sort();
}

function referencedNlsKeys(): Set<string> {
	const raw = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
	const keys = new Set<string>();
	for (const m of raw.matchAll(/%([\w.]+)%/g)) {
		keys.add(m[1]);
	}
	return keys;
}

test('nls: locale files exist and match the base key set exactly', () => {
	const base = new Set(Object.keys(readJson('package.nls.json')));
	const locales = nlsLocaleFiles();
	assert.ok(locales.length >= 4, `expected at least 4 locale files, found ${locales.length}`);
	for (const file of locales) {
		const keys = new Set(Object.keys(readJson(file)));
		const missing = [...base].filter((k) => !keys.has(k)).sort();
		const extra = [...keys].filter((k) => !base.has(k)).sort();
		assert.deepEqual({ missing, extra }, { missing: [], extra: [] }, `${file} differs from base`);
	}
});

test('nls: every %key% referenced in package.json resolves in the base file', () => {
	const base = new Set(Object.keys(readJson('package.nls.json')));
	const referenced = referencedNlsKeys();
	assert.ok(referenced.size > 10, `sanity: expected many %key% refs, found ${referenced.size}`);
	const unresolved = [...referenced].filter((k) => !base.has(k)).sort();
	assert.deepEqual(unresolved, [], 'package.json references missing nls keys');
});

test('nls: no base key is orphaned (unreferenced by package.json)', () => {
	const base = Object.keys(readJson('package.nls.json'));
	const referenced = referencedNlsKeys();
	const orphans = base.filter((k) => !referenced.has(k)).sort();
	assert.deepEqual(orphans, [], 'package.nls.json carries unreferenced keys');
});
