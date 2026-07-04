import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	containedUvEnv,
	installerScriptUrl,
	knownUvLocations,
	uvBinaryName,
	uvPathIn,
	venvPlan,
} from '../../util/uvInstall';

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

test('containedUvEnv: confines managed Python and cache to subdirs of our storage', () => {
	assert.deepEqual(containedUvEnv('C:\\store', 'win32'), {
		UV_PYTHON_INSTALL_DIR: 'C:\\store\\python',
		UV_CACHE_DIR: 'C:\\store\\cache',
	});
	assert.deepEqual(containedUvEnv('/root/store', 'linux'), {
		UV_PYTHON_INSTALL_DIR: '/root/store/python',
		UV_CACHE_DIR: '/root/store/cache',
	});
});

test('venvPlan: pins an explicitly picked Python, no download', () => {
	assert.deepEqual(venvPlan('/usr/bin/python3', true), {
		managed: false,
		venvArgs: ['venv', '--python', '/usr/bin/python3'],
		downloads: 'never',
	});
	// A picked Python wins even if no other system Python was detected.
	assert.deepEqual(venvPlan('C:\\Py\\python.exe', false), {
		managed: false,
		venvArgs: ['venv', '--python', 'C:\\Py\\python.exe'],
		downloads: 'never',
	});
});

test('venvPlan: uses a discovered system Python, no download', () => {
	assert.deepEqual(venvPlan(undefined, true), {
		managed: false,
		venvArgs: ['venv'],
		downloads: 'never',
	});
});

test('venvPlan: downloads a managed Python only when none exists', () => {
	assert.deepEqual(venvPlan(undefined, false), {
		managed: true,
		venvArgs: ['venv', '--python', '3'],
		downloads: 'automatic',
	});
});
