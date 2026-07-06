import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { XOUS_TARGET_TRIPLE } from '@constants';
import * as logService from '@services/logService';
import * as procService from '@services/procService';
import { convertElfToUf2 } from '@services/uf2ConvertService';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import { activateExtension, cleanupTmpDirs, fakeChannel, tmpDir, useSandbox } from './helpers';

/** A fake out-of-tree project: a Cargo.toml package name plus a built ELF for that package. */
function fakeOotProject(pkgName: string): string {
	const root = tmpDir();
	fs.writeFileSync(path.join(root, 'Cargo.toml'), `[package]\nname = "${pkgName}"\n`, 'utf8');
	const releaseDir = path.join(root, 'target', XOUS_TARGET_TRIPLE, 'release');
	fs.mkdirSync(releaseDir, { recursive: true });
	fs.writeFileSync(path.join(releaseDir, pkgName), 'ELF', 'utf8');
	return root;
}

suite('UF2 conversion', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	teardown(() => cleanupTmpDirs());

	test('convertElfToUf2 records a spawn failure in the output channel, not just a toast', async () => {
		const root = fakeOotProject('my_oot_app');
		// A spawn failure never streams stdout/stderr, so the "See output" toast would otherwise
		// point at a channel with no failure detail.
		sandbox.stub(procService, 'runProcess').resolves({
			code: null,
			stdout: '',
			stderr: '',
			error: new Error('spawn xous-app-uf2 ENOENT'),
			cancelled: false,
		});
		const { lines, chan } = fakeChannel();
		sandbox.stub(logService, 'getBuildChannel').returns(chan);
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const ok = await convertElfToUf2(root);

		assert.equal(ok, false);
		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('conversion failed')),
			'failure toast shown',
		);
		assert.ok(
			lines.some((l) => l.includes('spawn xous-app-uf2 ENOENT')),
			'the spawn error reason is written to the Bao Build channel the toast points at',
		);
	});

	test('convertElfToUf2 returns true on a successful conversion', async () => {
		const root = fakeOotProject('my_oot_app');
		sandbox.stub(procService, 'runProcess').resolves({
			code: 0,
			stdout: '',
			stderr: '',
			cancelled: false,
		});

		assert.equal(await convertElfToUf2(root), true);
	});
});
