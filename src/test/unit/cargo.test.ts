import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import {
	addWorkspaceMemberToToml,
	buildOutOfTreeFeatures,
	discoverOutOfTreeCrates,
	hasPackageTable,
	hasWorkspaceTable,
	isValidBuildFlag,
	isValidCrateName,
	isValidFeatureName,
	parseCargoFeatures,
	parseCargoPackageName,
	parseWorkspaceMembers,
	parseXousCoreRev,
	readCargoPackageName,
	rewriteXousGitDepsToPaths,
	transformAppCargoToml,
} from '../../util/cargo';

test('parseCargoPackageName: reads a normal package name', () => {
	assert.equal(parseCargoPackageName('[package]\nname = "my_app"\nversion = "0.1.0"\n'), 'my_app');
});

test('parseCargoPackageName: tolerates extra whitespace around =', () => {
	assert.equal(parseCargoPackageName('name   =   "spaced"'), 'spaced');
});

test('parseCargoPackageName: returns null when there is no name field', () => {
	assert.equal(parseCargoPackageName('[package]\nversion = "0.1.0"\n'), null);
});

test('parseCargoPackageName: only matches a name at the start of a line', () => {
	// indented keys (e.g. a dependency table) are skipped; the top-level name wins
	const toml = '[dependencies]\n  name = "not-this"\n[package]\nname = "real_app"\n';
	assert.equal(parseCargoPackageName(toml), 'real_app');
});

test('readCargoPackageName: reads the name from a Cargo.toml on disk', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bao-cargo-'));
	try {
		fs.writeFileSync(path.join(dir, 'Cargo.toml'), '[package]\nname = "disk_app"\n');
		assert.equal(readCargoPackageName(dir), 'disk_app');
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test('readCargoPackageName: returns null when Cargo.toml is missing', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bao-cargo-'));
	try {
		assert.equal(readCargoPackageName(dir), null);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

const FIXED = ['--features', 'bao1x', '--features', 'utralib/bao1x'];

test('buildOutOfTreeFeatures: uses the given board target', () => {
	assert.deepEqual(buildOutOfTreeFeatures('baosec', []), ['--features', 'board-baosec', ...FIXED]);
});

test('isValidFeatureName: accepts typical cargo feature names', () => {
	for (const n of ['bao1x', 'board-dabao', 'utralib/bao1x', 'foo_bar', 'a']) {
		assert.equal(isValidFeatureName(n), true, n);
	}
});

test('isValidFeatureName: rejects empty, whitespace, flag-like, and metachar values', () => {
	for (const n of ['', ' ', 'foo bar', '--config', '-foo', 'a;b', 'a"b', 'a`b', 'a&b']) {
		assert.equal(isValidFeatureName(n), false, n);
	}
});

test('isValidCrateName: accepts real cargo package names', () => {
	for (const n of ['myapp', 'MyApp', 'foo_bar', 'foo-bar', 'a', '_private', '2fast']) {
		assert.equal(isValidCrateName(n), true, n);
	}
});

test('isValidCrateName: rejects path, metachar, and feature-only syntax', () => {
	for (const n of ['', ' ', 'a b', 'a/b', 'a.b', 'a+b', '../up', 'a;b', 'a$(x)', 'a`b', '-lead']) {
		assert.equal(isValidCrateName(n), false, n);
	}
});

test('buildOutOfTreeFeatures: appends each extra feature as its own --features flag', () => {
	assert.deepEqual(buildOutOfTreeFeatures('dabao', ['foo', 'bar']), [
		'--features',
		'board-dabao',
		...FIXED,
		'--features',
		'foo',
		'--features',
		'bar',
	]);
});

const WORKSPACE_TOML = '[workspace]\nmembers = [\n  "apps-dabao/hello",\n  "libs/util",\n]\n';

test('parseWorkspaceMembers: reads the members array', () => {
	assert.deepEqual(parseWorkspaceMembers(WORKSPACE_TOML), ['apps-dabao/hello', 'libs/util']);
});

test('parseWorkspaceMembers: empty when there is no members array', () => {
	assert.deepEqual(parseWorkspaceMembers('[package]\nname = "x"\n'), []);
});

test('parseWorkspaceMembers: ignores a commented-out member', () => {
	const toml = '[workspace]\nmembers = [\n  "apps-dabao/hello",\n  # "apps-dabao/old_app",\n]\n';
	assert.deepEqual(parseWorkspaceMembers(toml), ['apps-dabao/hello']);
});

test('parseWorkspaceMembers: a "]" inside a comment does not truncate the array', () => {
	const toml = '[workspace]\nmembers = [\n  "a",  # see [docs]\n  "b",\n]\n';
	assert.deepEqual(parseWorkspaceMembers(toml), ['a', 'b']);
});

test('addWorkspaceMemberToToml: appends the member before the closing bracket', () => {
	const updated = addWorkspaceMemberToToml(WORKSPACE_TOML, 'apps-dabao/new_app');
	assert.ok(updated, 'members array found');
	assert.ok(updated.includes('"apps-dabao/new_app",'), updated);
	assert.deepEqual(parseWorkspaceMembers(updated), [
		'apps-dabao/hello',
		'libs/util',
		'apps-dabao/new_app',
	]);
});

test('addWorkspaceMemberToToml: null when the members array cannot be found', () => {
	assert.equal(addWorkspaceMemberToToml('[package]\nname = "x"\n', 'apps-dabao/new_app'), null);
});

test('addWorkspaceMemberToToml: inserts a comma when the last member has none', () => {
	const toml = '[workspace]\nmembers = [\n  "apps-dabao/hello",\n  "libs/util"\n]\n';
	const updated = addWorkspaceMemberToToml(toml, 'apps-dabao/new_app');
	assert.ok(updated, 'members array found');
	assert.ok(updated.includes('"libs/util",'), 'missing comma added so the TOML stays valid');
	assert.deepEqual(parseWorkspaceMembers(updated), [
		'apps-dabao/hello',
		'libs/util',
		'apps-dabao/new_app',
	]);
});

test('addWorkspaceMemberToToml: inserts a comma when the last member has a trailing comment', () => {
	// The comment must not mask that "libs/util" lacks a comma before the appended entry.
	const toml = '[workspace]\nmembers = [\n  "apps-dabao/hello",\n  "libs/util"  # keep last\n]\n';
	const updated = addWorkspaceMemberToToml(toml, 'apps-dabao/new_app');
	assert.ok(updated, 'members array found');
	assert.ok(updated.includes('"libs/util",'), 'comma added despite the trailing comment');
	assert.deepEqual(parseWorkspaceMembers(updated), [
		'apps-dabao/hello',
		'libs/util',
		'apps-dabao/new_app',
	]);
});

test('addWorkspaceMemberToToml: no double comma when the last member ends with a comma before a comment', () => {
	const toml = '[workspace]\nmembers = [\n  "apps-dabao/hello",\n  "libs/util",  # trailing\n]\n';
	const updated = addWorkspaceMemberToToml(toml, 'apps-dabao/new_app');
	assert.ok(updated, 'members array found');
	assert.ok(!updated.includes('"libs/util",,'), 'no doubled comma');
	assert.deepEqual(parseWorkspaceMembers(updated), [
		'apps-dabao/hello',
		'libs/util',
		'apps-dabao/new_app',
	]);
});

const APP_TEMPLATE = [
	'[package]',
	'name = "{{NAME}}"',
	'version = "0.1.0"',
	'',
	'[dependencies]',
	'xous = { git = "https://github.com/betrusted-io/xous-core", rev = "{{REV}}" }',
	'',
	'[patch.crates-io]',
	'utralib = { git = "https://github.com/betrusted-io/xous-core", rev = "{{REV}}" }',
	'',
].join('\n');

test('transformAppCargoToml: substitutes the app name everywhere', () => {
	const out = transformAppCargoToml(APP_TEMPLATE, 'my_app');
	assert.ok(out.includes('name = "my_app"'), out);
	assert.ok(!out.includes('{{NAME}}'), 'no template placeholder left');
});

test('transformAppCargoToml: strips the pinned rev and the [patch.crates-io] section', () => {
	const out = transformAppCargoToml(APP_TEMPLATE, 'my_app');
	assert.ok(!out.includes('{{REV}}'), 'no rev placeholder left');
	assert.ok(!out.includes('rev ='), 'rev key removed entirely');
	assert.ok(!out.includes('[patch.crates-io]'), 'patch.crates-io section removed');
	assert.ok(out.endsWith('\n'), 'ends with a single trailing newline');
});

const PKG_MAP = new Map([
	['xous', 'xous-rs'],
	['utralib', 'utralib'],
]);

test('rewriteXousGitDepsToPaths: rewrites xous-core git deps to path deps, preserving other keys', () => {
	const cargo = [
		'[dependencies]',
		'xous = { git = "https://github.com/betrusted-io/xous-core", features = ["std"], optional = true }',
		'utralib = { git = "https://github.com/betrusted-io/xous-core" }',
	].join('\n');
	const { toml, missing } = rewriteXousGitDepsToPaths(
		cargo,
		PKG_MAP,
		'/xc/apps-dabao/new_app',
		'/xc',
	);
	assert.deepEqual(missing, []);
	assert.ok(
		toml.includes('xous = { path = "../../xous-rs", features = ["std"], optional = true }'),
		toml,
	);
	assert.ok(toml.includes('utralib = { path = "../../utralib" }'), toml);
	assert.ok(!toml.includes('git ='), 'no xous-core git source left');
	assert.ok(!toml.includes('[patch'), 'no patch section emitted');
});

test('rewriteXousGitDepsToPaths: resolves aliased deps via package = "..." and keeps the alias', () => {
	const cargo =
		'my-alias = { package = "xous", git = "https://github.com/betrusted-io/xous-core" }';
	const { toml, missing } = rewriteXousGitDepsToPaths(
		cargo,
		PKG_MAP,
		'/xc/apps-dabao/new_app',
		'/xc',
	);
	assert.deepEqual(missing, []);
	assert.ok(
		toml.includes('my-alias = { package = "xous", path = "../../xous-rs" }'),
		`alias kept, source swapped:\n${toml}`,
	);
});

test('rewriteXousGitDepsToPaths: drops branch/tag/rev pins along with the git source', () => {
	const cargo =
		'xous = { git = "https://github.com/betrusted-io/xous-core", branch = "main", optional = true }';
	const { toml } = rewriteXousGitDepsToPaths(cargo, PKG_MAP, '/xc/apps-dabao/new_app', '/xc');
	assert.ok(toml.includes('xous = { path = "../../xous-rs", optional = true }'), toml);
	assert.ok(!toml.includes('branch'), 'branch pin dropped');
});

test('rewriteXousGitDepsToPaths: reports crates missing from the tree and leaves them untouched', () => {
	const cargo = [
		'xous = { git = "https://github.com/betrusted-io/xous-core" }',
		'mystery = { git = "https://github.com/betrusted-io/xous-core" }',
	].join('\n');
	const { toml, missing } = rewriteXousGitDepsToPaths(
		cargo,
		PKG_MAP,
		'/xc/apps-dabao/new_app',
		'/xc',
	);
	assert.deepEqual(missing, ['mystery']);
	assert.ok(
		toml.includes('mystery = { git = "https://github.com/betrusted-io/xous-core" }'),
		'unknown crate left as-is for the caller to reject',
	);
});

test('rewriteXousGitDepsToPaths: leaves other git repos and registry deps untouched', () => {
	const cargo = [
		'serde = { version = "1" }',
		'other = { git = "https://github.com/betrusted-io/xous-usb-hid.git", branch = "main" }',
		'local = { path = "../local" }',
	].join('\n');
	const { toml, missing } = rewriteXousGitDepsToPaths(cargo, PKG_MAP, '/xc/apps-dabao/a', '/xc');
	assert.deepEqual(missing, []);
	assert.equal(toml, cargo, 'nothing rewritten');
});

/* ------------------------------ workspace / package tables ------------------------------ */

test('hasWorkspaceTable / hasPackageTable: plain package project', () => {
	const toml = '[package]\nname = "solo"\n';
	assert.equal(hasPackageTable(toml), true);
	assert.equal(hasWorkspaceTable(toml), false);
});

test('hasWorkspaceTable / hasPackageTable: workspace with no root crate', () => {
	const toml = '[workspace]\nmembers = ["a"]\n';
	assert.equal(hasPackageTable(toml), false);
	assert.equal(hasWorkspaceTable(toml), true);
});

test('hasWorkspaceTable: a commented-out table does not count', () => {
	assert.equal(hasWorkspaceTable('# [workspace]\n[package]\nname = "x"\n'), false);
});

test('hasWorkspaceTable: [workspace.package] is not [workspace]', () => {
	assert.equal(hasWorkspaceTable('[workspace.package]\nedition = "2021"\n'), false);
});

/* ------------------------------ discoverOutOfTreeCrates ------------------------------ */

/** Build a temp project tree: files is a map of relative path -> contents. */
function withProject(files: Record<string, string>, run: (dir: string) => void): void {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bao-crates-'));
	try {
		for (const [rel, body] of Object.entries(files)) {
			const full = path.join(dir, rel);
			fs.mkdirSync(path.dirname(full), { recursive: true });
			fs.writeFileSync(full, body);
		}
		run(dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

test('discoverOutOfTreeCrates: plain package project yields its one crate', () => {
	withProject({ 'Cargo.toml': '[package]\nname = "solo_app"\n' }, (dir) => {
		const { crates, wildcardMembers, unreadableMembers } = discoverOutOfTreeCrates(dir);
		assert.deepEqual(
			crates.map((c) => c.name),
			['solo_app'],
		);
		assert.equal(crates[0].manifestPath, path.join(dir, 'Cargo.toml'));
		assert.deepEqual(wildcardMembers, []);
		assert.deepEqual(unreadableMembers, []);
	});
});

test('discoverOutOfTreeCrates: workspace with no root crate yields one entry per member', () => {
	withProject(
		{
			'Cargo.toml': '[workspace]\nmembers = ["crates/alpha", "crates/beta"]\n',
			'crates/alpha/Cargo.toml': '[package]\nname = "alpha"\n',
			'crates/beta/Cargo.toml': '[package]\nname = "beta"\n',
		},
		(dir) => {
			const { crates, unreadableMembers } = discoverOutOfTreeCrates(dir);
			assert.deepEqual(
				crates.map((c) => c.name),
				['alpha', 'beta'],
			);
			assert.equal(crates[0].manifestPath, path.join(dir, 'crates/alpha', 'Cargo.toml'));
			assert.deepEqual(unreadableMembers, []);
		},
	);
});

test('discoverOutOfTreeCrates: a root package is a member of its own workspace', () => {
	withProject(
		{
			'Cargo.toml': '[package]\nname = "root_app"\n\n[workspace]\nmembers = ["helper"]\n',
			'helper/Cargo.toml': '[package]\nname = "helper"\n',
		},
		(dir) => {
			const { crates } = discoverOutOfTreeCrates(dir);
			assert.deepEqual(
				crates.map((c) => c.name),
				['root_app', 'helper'],
			);
		},
	);
});

test('discoverOutOfTreeCrates: a root crate listed in its own members is not returned twice', () => {
	withProject(
		{ 'Cargo.toml': '[package]\nname = "root_app"\n\n[workspace]\nmembers = ["."]\n' },
		(dir) => {
			const { crates } = discoverOutOfTreeCrates(dir);
			assert.deepEqual(
				crates.map((c) => c.name),
				['root_app'],
			);
		},
	);
});

test('discoverOutOfTreeCrates: wildcard members are reported, not expanded', () => {
	withProject(
		{
			'Cargo.toml': '[workspace]\nmembers = ["crates/*", "tools/one"]\n',
			'crates/alpha/Cargo.toml': '[package]\nname = "alpha"\n',
			'tools/one/Cargo.toml': '[package]\nname = "one"\n',
		},
		(dir) => {
			const { crates, wildcardMembers } = discoverOutOfTreeCrates(dir);
			assert.deepEqual(
				crates.map((c) => c.name),
				['one'],
				'the wildcard contributes nothing',
			);
			assert.deepEqual(wildcardMembers, ['crates/*']);
		},
	);
});

test('discoverOutOfTreeCrates: a member with no manifest is reported as unreadable', () => {
	withProject(
		{
			'Cargo.toml': '[workspace]\nmembers = ["present", "gone"]\n',
			'present/Cargo.toml': '[package]\nname = "present"\n',
		},
		(dir) => {
			const { crates, unreadableMembers } = discoverOutOfTreeCrates(dir);
			assert.deepEqual(
				crates.map((c) => c.name),
				['present'],
			);
			assert.deepEqual(unreadableMembers, ['gone']);
		},
	);
});

test('discoverOutOfTreeCrates: a workspace-only manifest does not borrow a name from another table', () => {
	withProject(
		{ 'Cargo.toml': '[workspace]\nmembers = []\n\n[workspace.package]\nname = "not_a_crate"\n' },
		(dir) => {
			const { crates } = discoverOutOfTreeCrates(dir);
			assert.deepEqual(crates, []);
		},
	);
});

test('discoverOutOfTreeCrates: a folder with no Cargo.toml yields nothing and no complaints', () => {
	withProject({ 'readme.txt': 'not a cargo project\n' }, (dir) => {
		const result = discoverOutOfTreeCrates(dir);
		assert.deepEqual(result, { crates: [], wildcardMembers: [], unreadableMembers: [] });
	});
});

/* ------------------------------ parseCargoFeatures ------------------------------ */

test('parseCargoFeatures: reads an empty declaration, as apps use to satisfy the board flag', () => {
	const toml = [
		'[package]',
		'name = "helloworld"',
		'',
		'[features]',
		'bao1x = ["utralib/bao1x"]',
		'board-dabao = []',
		'default = []',
	].join('\n');

	assert.deepEqual(parseCargoFeatures(toml), ['bao1x', 'board-dabao', 'default']);
});

test('parseCargoFeatures: skips the entries inside a multi-line value', () => {
	const toml = [
		'[features]',
		'board-dabao = [',
		'    "bao1x-hal-service/board-dabao",',
		'    # "bao1x-hal/debug-print-uart",',
		'    "usb-bao1x/board-dabao",',
		']',
		'usb = []',
	].join('\n');

	assert.deepEqual(parseCargoFeatures(toml), ['board-dabao', 'usb']);
});

test('parseCargoFeatures: stops at the next table', () => {
	const toml = [
		'[features]',
		'board-dabao = []',
		'',
		'[dependencies]',
		'utralib = { path = "../utralib" }',
	].join('\n');

	assert.deepEqual(parseCargoFeatures(toml), ['board-dabao']);
});

test('parseCargoFeatures: a commented-out table header is not a features table', () => {
	const toml = ['[package]', 'name = "lib"', '# [features]', '# board-dabao = []'].join('\n');

	assert.deepEqual(parseCargoFeatures(toml), []);
});

test('parseCargoFeatures: no features table yields nothing', () => {
	assert.deepEqual(parseCargoFeatures('[package]\nname = "lib"\n'), []);
});

/* ------------------------------ parseXousCoreRev ------------------------------ */

test('parseXousCoreRev: reads the pin from a xous-core git dependency', () => {
	const toml = [
		'[dependencies]',
		'serde = "1"',
		'bao1x-api = { git = "https://github.com/betrusted-io/xous-core", rev = "abc123def" }',
	].join('\n');

	assert.equal(parseXousCoreRev(toml), 'abc123def');
});

test('parseXousCoreRev: ignores revisions pinned on other repositories', () => {
	const toml = '[dependencies]\nother = { git = "https://github.com/someone/else", rev = "zzz" }\n';

	assert.equal(parseXousCoreRev(toml), null);
});

test('parseXousCoreRev: null when xous-core is pinned by branch instead', () => {
	const toml =
		'[dependencies]\nbao1x-api = { git = "https://github.com/betrusted-io/xous-core", branch = "main" }\n';

	assert.equal(parseXousCoreRev(toml), null);
});

/* ------------------------------ isValidBuildFlag ------------------------------ */

test('isValidBuildFlag: accepts the switches cargo xtask documents', () => {
	for (const flag of ['--no-timestamp', '--no-verify', '--app']) {
		assert.equal(isValidBuildFlag(flag), true, flag);
	}
});

test('isValidBuildFlag: rejects anything that could carry a second argument', () => {
	for (const flag of [
		'--feature usb',
		'-no-verify',
		'no-verify',
		'--No-Verify',
		'--x;rm -rf /',
		'',
	]) {
		assert.equal(isValidBuildFlag(flag), false, JSON.stringify(flag));
	}
});
