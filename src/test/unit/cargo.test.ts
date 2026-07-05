import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	addWorkspaceMemberToToml,
	buildOutOfTreeFeatures,
	generateXousPatchSection,
	isValidCrateName,
	isValidFeatureName,
	parseCargoPackageName,
	parseWorkspaceMembers,
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

const FIXED = ['--features', 'bao1x', '--features', 'utralib/bao1x'];

test('buildOutOfTreeFeatures: defaults to board-dabao with the fixed features', () => {
	assert.deepEqual(buildOutOfTreeFeatures('', []), ['--features', 'board-dabao', ...FIXED]);
});

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

test('generateXousPatchSection: maps xous-core git deps to local workspace paths', () => {
	const cargo = [
		'[dependencies]',
		'xous = { git = "https://github.com/betrusted-io/xous-core" }',
		'utralib = { git = "https://github.com/betrusted-io/xous-core" }',
	].join('\n');
	const out = generateXousPatchSection(cargo, PKG_MAP, '/xc/apps-dabao/new_app', '/xc');
	assert.ok(out.includes('[patch."https://github.com/betrusted-io/xous-core"]'), out);
	assert.ok(out.includes('xous = { path = "../../xous-rs" }'), out);
	assert.ok(out.includes('utralib = { path = "../../utralib" }'), out);
});

test('generateXousPatchSection: resolves aliased deps via package = "..."', () => {
	const cargo =
		'my-alias = { package = "xous", git = "https://github.com/betrusted-io/xous-core" }';
	const out = generateXousPatchSection(cargo, PKG_MAP, '/xc/apps-dabao/new_app', '/xc');
	assert.ok(out.includes('xous = { path = "../../xous-rs" }'), out);
	assert.ok(!out.includes('my-alias'), 'patch entry uses the real package name');
});

test('generateXousPatchSection: dedupes repeated deps and skips unknown packages', () => {
	const cargo = [
		'xous = { git = "https://github.com/betrusted-io/xous-core" }',
		'xous = { git = "https://github.com/betrusted-io/xous-core" }',
		'mystery = { git = "https://github.com/betrusted-io/xous-core" }',
	].join('\n');
	const out = generateXousPatchSection(cargo, PKG_MAP, '/xc/apps-dabao/new_app', '/xc');
	const occurrences = out.split('xous = { path').length - 1;
	assert.equal(occurrences, 1, 'each package patched once');
	assert.ok(!out.includes('mystery'), 'packages not in the workspace map are skipped');
});

test('generateXousPatchSection: empty when nothing points at xous-core', () => {
	const cargo = 'serde = { version = "1" }\nlocal = { path = "../local" }';
	assert.equal(generateXousPatchSection(cargo, PKG_MAP, '/xc/apps-dabao/a', '/xc'), '');
});
