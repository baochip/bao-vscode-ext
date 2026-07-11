import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

// Static guards for the l10n bundles: every string passed to vscode.l10n.t() in src must exist
// as a key in every bundle, all bundles must agree on their key sets, and no bundle may carry
// orphaned keys (strings no longer used anywhere in src).

const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC_DIR = path.join(ROOT, 'src');
const L10N_DIR = path.join(ROOT, 'l10n');

function listSourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (full === path.join(SRC_DIR, 'test')) continue; // tests are not localized
			files.push(...listSourceFiles(full));
		} else if (entry.name.endsWith('.ts')) {
			files.push(full);
		}
	}
	return files;
}

/** Decode the escapes that appear in this codebase's string literals. */
function unescapeLiteral(raw: string): string {
	return raw.replace(/\\(.)/g, (_, c: string) => {
		if (c === 'n') return '\n';
		if (c === 't') return '\t';
		if (c === 'r') return '\r';
		return c; // \' \" \\ and anything else escape to the character itself
	});
}

/**
 * Extract every l10n.t() key from a source text. The key is the first argument: a string
 * literal, or several string literals joined with `+` (used for long modal messages).
 */
function extractL10nKeys(source: string): string[] {
	const keys: string[] = [];
	const callRe = /\bl10n\.t\(\s*/g;
	const literalRe = /'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"/y;
	const joinRe = /\s*\+\s*/y;

	for (let m = callRe.exec(source); m !== null; m = callRe.exec(source)) {
		let pos = callRe.lastIndex;
		let key = '';
		for (;;) {
			literalRe.lastIndex = pos;
			const lit = literalRe.exec(source);
			if (!lit) break;
			key += unescapeLiteral(lit[1] ?? lit[2] ?? '');
			pos = literalRe.lastIndex;
			joinRe.lastIndex = pos;
			const join = joinRe.exec(source);
			if (!join) break;
			pos = joinRe.lastIndex;
		}
		if (key) keys.push(key);
	}
	return keys;
}

function usedKeys(): Set<string> {
	const keys = new Set<string>();
	for (const file of listSourceFiles(SRC_DIR)) {
		for (const key of extractL10nKeys(fs.readFileSync(file, 'utf8'))) {
			keys.add(key);
		}
	}
	return keys;
}

function bundleFiles(): string[] {
	return fs
		.readdirSync(L10N_DIR)
		.filter((f) => f.startsWith('bundle.l10n.') && f.endsWith('.json'))
		.map((f) => path.join(L10N_DIR, f));
}

function bundleKeys(file: string): Set<string> {
	return new Set(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))));
}

test('l10n: all bundles carry the same key set', () => {
	const files = bundleFiles();
	assert.ok(files.length >= 4, `expected at least 4 bundles, found ${files.length}`);
	const [first, ...rest] = files;
	const firstKeys = bundleKeys(first);
	for (const file of rest) {
		const keys = bundleKeys(file);
		const missing = [...firstKeys].filter((k) => !keys.has(k));
		const extra = [...keys].filter((k) => !firstKeys.has(k));
		assert.deepEqual(
			{ missing, extra },
			{ missing: [], extra: [] },
			`${path.basename(file)} differs from ${path.basename(first)}`,
		);
	}
});

test('l10n: every string used in src exists in every bundle', () => {
	const used = usedKeys();
	assert.ok(used.size > 100, `sanity: expected many l10n keys, extracted ${used.size}`);
	for (const file of bundleFiles()) {
		const keys = bundleKeys(file);
		const missing = [...used].filter((k) => !keys.has(k)).sort();
		assert.deepEqual(missing, [], `keys missing from ${path.basename(file)}`);
	}
});

test('l10n: no bundle key is orphaned (unused in src)', () => {
	const used = usedKeys();
	for (const file of bundleFiles()) {
		const orphans = [...bundleKeys(file)].filter((k) => !used.has(k)).sort();
		assert.deepEqual(orphans, [], `orphaned keys in ${path.basename(file)}`);
	}
});

/** The {N} placeholder indices in a string as a sorted MULTISET (duplicates kept), so a dropped,
 * added, or duplicated placeholder is caught - not just a changed set of distinct indices. */
function placeholders(s: string): string[] {
	return [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort();
}

test('l10n: every translation preserves the {N} placeholders of its English key', () => {
	for (const file of bundleFiles()) {
		const bundle = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
		const mismatches: string[] = [];
		for (const [key, value] of Object.entries(bundle)) {
			const want = placeholders(key);
			const got = placeholders(value);
			if (want.join(',') !== got.join(',')) {
				mismatches.push(`"${key}" expects {${want}} but has {${got}}`);
			}
		}
		assert.deepEqual(mismatches, [], `placeholder mismatch in ${path.basename(file)}`);
	}
});

test('l10n: every l10n.t() key in src is a string literal (statically checkable)', () => {
	// A non-literal key (l10n.t(someVar)) cannot be extracted or verified by the guards above,
	// so it would silently escape the bundle checks. Keep every key a literal.
	const offenders: string[] = [];
	for (const file of listSourceFiles(SRC_DIR)) {
		const source = fs.readFileSync(file, 'utf8');
		for (const m of source.matchAll(/\bl10n\.t\(\s*([^'"\s)])/g)) {
			offenders.push(`${path.relative(ROOT, file)}: l10n.t(${m[1]}...`);
		}
	}
	assert.deepEqual(offenders, [], 'l10n.t() called with a non-literal key');
});

// Values a bundle may legitimately leave identical to their English key, listed PER LOCALE. German
// keeps the loanwords, cargo-labelled build/clean actions, terminal-tab names, status-bar item
// names, and brand tokens in English; ja/zh translate most of them and keep only code tokens and
// tech terms. A value===key not listed for its locale is almost always an accidentally-untranslated
// string. Deliberately keeping one English? Add it under that locale (and only that locale).
const ALLOWED_UNTRANSLATED: Record<string, ReadonlySet<string>> = {
	de: new Set([
		'test_app',
		'auto',
		'MD5: {0}',
		'Bootloader',
		'Run',
		'Monitor',
		'Setup',
		'Build & Run',
		'Build (cargo xtask)',
		'Build (cargo build)',
		'Clean',
		'Clean (cargo clean)',
		'Build • Flash • Monitor',
		'Baochip Build',
		'Baochip Clean',
		'Baochip Monitor ({0}: {1})',
		'Baochip: App',
		'Baochip: Build',
		'Baochip: Build • Flash • Monitor',
		'Baochip: Clean',
		'Baochip: Flash',
		'Baochip: Monitor',
	]),
	ja: new Set(['test_app', 'auto', 'MD5: {0}']),
	'zh-cn': new Set(['test_app', 'auto']),
	'zh-tw': new Set(['test_app', 'auto']),
};

/** Locale code from a bundle path, e.g. .../bundle.l10n.zh-cn.json -> "zh-cn". */
function localeOf(file: string): string {
	const m = /^bundle\.l10n\.(.+)\.json$/.exec(path.basename(file));
	if (!m) throw new Error(`unexpected bundle filename: ${path.basename(file)}`);
	return m[1];
}

test('l10n: no bundle value is left untranslated (equal to its English key) outside its locale allowlist', () => {
	for (const file of bundleFiles()) {
		const allowed = ALLOWED_UNTRANSLATED[localeOf(file)] ?? new Set<string>();
		const bundle = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
		const untranslated = Object.keys(bundle)
			.filter((k) => bundle[k] === k && !allowed.has(k))
			.sort();
		assert.deepEqual(
			untranslated,
			[],
			`untranslated (value === key) strings in ${path.basename(file)}`,
		);
	}
});

test('l10n: every per-locale untranslated-allowlist entry is real (present and still English)', () => {
	const byLocale = new Map(bundleFiles().map((f) => [localeOf(f), f]));
	for (const [locale, allowed] of Object.entries(ALLOWED_UNTRANSLATED)) {
		const file = byLocale.get(locale);
		assert.ok(file, `allowlist names locale "${locale}" but no such bundle exists`);
		const bundle = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
		const stale = [...allowed].filter((k) => bundle[k] !== k).sort();
		assert.deepEqual(
			stale,
			[],
			`stale allowlist entries for ${locale} (translated or removed - drop them from the allowlist)`,
		);
	}
});

test('l10n: l10n.t is only ever called directly, never aliased/destructured', () => {
	// An aliased call (const t = vscode.l10n.t; t('...')) evades both the key extraction and the
	// literal-key guard, so a string used that way could silently be missing from every bundle. Every
	// l10n.t occurrence in src must be a direct call (immediately followed by "(").
	const offenders: string[] = [];
	for (const file of listSourceFiles(SRC_DIR)) {
		if (/\bl10n\.t\b(?!\s*\()/.test(fs.readFileSync(file, 'utf8'))) {
			offenders.push(path.relative(ROOT, file));
		}
	}
	assert.deepEqual(offenders, [], 'l10n.t must be called directly, not aliased/destructured');
});
