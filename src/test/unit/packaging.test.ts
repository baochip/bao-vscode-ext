import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

// Packaging guard: the welcome webview loads codicon.css/codicon.ttf straight from
// node_modules/@vscode/codicons/dist, which .vscodeignore's node_modules glob would
// normally exclude from the .vsix (leaving the installed extension with blank icons).
// Assert that `vsce ls` still includes every asset the webview references.

const ROOT = path.resolve(__dirname, '..', '..', '..');

const REQUIRED_FILES = [
	'node_modules/@vscode/codicons/dist/codicon.css',
	'node_modules/@vscode/codicons/dist/codicon.ttf',
	'media/css/welcome.css',
	'media/js/welcome.js',
	'media/logo.svg',
];

/** Dev-only files that must never ship in the .vsix. */
const FORBIDDEN_FILES = ['.nvmrc', '.pre-commit-config.yaml', 'biome.json', 'eslint.config.mjs'];

let packagedCache: Set<string> | undefined;
function listPackagedFiles(): Set<string> {
	if (!packagedCache) {
		const vsceBin = path.join(ROOT, 'node_modules', '@vscode', 'vsce', 'vsce');
		const output = execFileSync(process.execPath, [vsceBin, 'ls'], {
			cwd: ROOT,
			encoding: 'utf8',
			maxBuffer: 10 * 1024 * 1024,
		});
		packagedCache = new Set(output.split(/\r?\n/).map((line) => line.trim()));
	}
	return packagedCache;
}

test('packaging: vsce ls includes all welcome webview assets', () => {
	const packaged = listPackagedFiles();
	const missing = REQUIRED_FILES.filter((f) => !packaged.has(f));
	assert.deepEqual(missing, [], 'files missing from the vsce package listing');
});

test('packaging: vsce ls excludes dev-only config files and caches', () => {
	const packaged = listPackagedFiles();
	const leaked = FORBIDDEN_FILES.filter((f) => packaged.has(f));
	assert.deepEqual(leaked, [], 'dev-only files leaked into the package listing');
	const caches = [...packaged].filter((f) => f.includes('.pytest_cache'));
	assert.deepEqual(caches, [], 'pytest cache leaked into the package listing');
});

// Stale-output guard: out/ accumulates compiled files from renamed/deleted sources, and
// vsce packages whatever is on disk. vscode:prepublish must clean out/ before compiling
// so old layouts cannot ship in the .vsix.

test('packaging: vscode:prepublish cleans out/ before compiling', () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
	assert.equal(pkg.scripts['vscode:prepublish'], 'npm run clean && npm run compile');
});

test('packaging: the clean script removes out/ recursively', () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
	const clean: string = pkg.scripts.clean;
	const inline = clean.match(/^node -e "(.*)"$/)?.[1];
	assert.ok(inline, `clean script is not a node -e one-liner: ${clean}`);

	// Run the actual inline script in a temp cwd so the repo's real out/ is untouched.
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bao-clean-test-'));
	try {
		fs.mkdirSync(path.join(tmp, 'out', 'panels'), { recursive: true });
		fs.writeFileSync(path.join(tmp, 'out', 'panels', 'stale.js'), '');
		execFileSync(process.execPath, ['-e', inline], { cwd: tmp });
		assert.ok(!fs.existsSync(path.join(tmp, 'out')), 'out/ should be removed');
		execFileSync(process.execPath, ['-e', inline], { cwd: tmp }); // idempotent when absent
	} finally {
		fs.rmSync(tmp, { recursive: true, force: true });
	}
});
