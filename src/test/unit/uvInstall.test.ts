import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installerScriptUrl, knownUvLocations, uvBinaryName, uvPathIn } from '../../util/uvInstall';

test('installerScriptUrl: PowerShell script on Windows, shell script elsewhere', () => {
	assert.equal(installerScriptUrl('win32'), 'https://astral.sh/uv/install.ps1');
	assert.equal(installerScriptUrl('linux'), 'https://astral.sh/uv/install.sh');
	assert.equal(installerScriptUrl('darwin'), 'https://astral.sh/uv/install.sh');
});

test('uvBinaryName: .exe on Windows, bare name elsewhere', () => {
	assert.equal(uvBinaryName('win32'), 'uv.exe');
	assert.equal(uvBinaryName('linux'), 'uv');
	assert.equal(uvBinaryName('darwin'), 'uv');
});

test('uvPathIn: joins with the platform separator and binary name', () => {
	assert.equal(uvPathIn('C:\\storage\\uv', 'win32'), 'C:\\storage\\uv\\uv.exe');
	assert.equal(uvPathIn('/home/u/.local/share/uv', 'linux'), '/home/u/.local/share/uv/uv');
});

test('knownUvLocations: standalone and cargo targets for the platform', () => {
	assert.deepEqual(knownUvLocations('/home/u', 'linux'), [
		'/home/u/.local/bin/uv',
		'/home/u/.cargo/bin/uv',
	]);
	assert.deepEqual(knownUvLocations('C:\\Users\\First Last', 'win32'), [
		'C:\\Users\\First Last\\.local\\bin\\uv.exe',
		'C:\\Users\\First Last\\.cargo\\bin\\uv.exe',
	]);
});
