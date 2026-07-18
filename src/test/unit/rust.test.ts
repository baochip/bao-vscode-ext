import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	detectHostToolchainGap,
	parseRustcVersion,
	pickHighestPatchIndex,
	selectXousToolkitAsset,
} from '../../util/rust';

test('parseRustcVersion: reads a standard version line', () => {
	assert.equal(parseRustcVersion('rustc 1.87.0 (17067e9ac 2025-05-09)'), '1.87.0');
});

test('parseRustcVersion: reads a nightly version (stops before the channel suffix)', () => {
	assert.equal(parseRustcVersion('rustc 1.90.0-nightly (abc1234 2025-06-01)'), '1.90.0');
});

test('parseRustcVersion: returns null for empty or unrecognized output', () => {
	assert.equal(parseRustcVersion(''), null);
	assert.equal(parseRustcVersion("'rustc' is not recognized as a command"), null);
});

test('pickHighestPatchIndex: picks the highest patch from a newest-first list', () => {
	assert.equal(pickHighestPatchIndex(['1.87.0.2', '1.87.0.1'], '1.87.0'), 0);
});

test('pickHighestPatchIndex: picks the highest patch regardless of list order', () => {
	assert.equal(pickHighestPatchIndex(['1.87.0.1', '1.87.0.2'], '1.87.0'), 1);
	assert.equal(pickHighestPatchIndex(['1.87.0.1', '1.87.0.10', '1.87.0.9'], '1.87.0'), 1);
});

test('pickHighestPatchIndex: a bare version tag counts as patch 0', () => {
	assert.equal(pickHighestPatchIndex(['1.87.0', '1.87.0.1'], '1.87.0'), 1);
	assert.equal(pickHighestPatchIndex(['1.87.0'], '1.87.0'), 0);
});

test('pickHighestPatchIndex: unparsable suffixes rank lowest; all-unparsable keeps the newest', () => {
	assert.equal(pickHighestPatchIndex(['1.87.0-rc1', '1.87.0.1'], '1.87.0'), 1);
	assert.equal(pickHighestPatchIndex(['1.87.0-beta', '1.87.0x'], '1.87.0'), 0);
});

test('selectXousToolkitAsset: picks the host-independent xous target zip', () => {
	const assets = [
		{ name: 'riscv32emc-unknown-none_1.97.1.zip' },
		{ name: 'riscv32imac-unknown-xous_1.97.1.zip' },
	];
	assert.equal(
		selectXousToolkitAsset(assets, 'riscv32imac-unknown-xous-elf')?.name,
		'riscv32imac-unknown-xous_1.97.1.zip',
	);
});

test('selectXousToolkitAsset: ignores other targets and non-zip names', () => {
	const target = 'riscv32imac-unknown-xous-elf';
	assert.equal(
		selectXousToolkitAsset([{ name: 'riscv32emc-unknown-none_1.97.1.zip' }], target),
		undefined,
	);
	// the bare target name without a .zip extension must not match
	assert.equal(selectXousToolkitAsset([{ name: 'riscv32imac-unknown-xous' }], target), undefined);
});

test('selectXousToolkitAsset: returns undefined for empty or nameless assets', () => {
	const target = 'riscv32imac-unknown-xous-elf';
	assert.equal(selectXousToolkitAsset([], target), undefined);
	assert.equal(selectXousToolkitAsset([{ name: 123 }, {}], target), undefined);
});

test('detectHostToolchainGap: flags a missing MinGW dlltool as mingw', () => {
	const out =
		"error: error calling dlltool 'dlltool.exe': program not found\nerror: could not compile `windows-sys`";
	assert.equal(detectHostToolchainGap(out), 'mingw');
});

test('detectHostToolchainGap: flags a missing MSVC link.exe as msvc', () => {
	const out =
		'error: linker `link.exe` not found\nnote: the msvc targets depend on the msvc linker';
	assert.equal(detectHostToolchainGap(out), 'msvc');
});

test('detectHostToolchainGap: returns undefined for an unrelated failure or empty output', () => {
	assert.equal(
		detectHostToolchainGap('error: could not compile `foo` due to 3 previous errors'),
		undefined,
	);
	assert.equal(detectHostToolchainGap(''), undefined);
});
