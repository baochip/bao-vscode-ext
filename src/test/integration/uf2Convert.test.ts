import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { XOUS_TARGET_TRIPLE } from '@constants';
import * as logService from '@services/logService';
import * as procService from '@services/procService';
import { convertElfToUf2 } from '@services/uf2ConvertService';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
	activateExtension,
	cleanupTmpDirs,
	DABAO_APP_START,
	DABAO_APP_UF2_LIMIT,
	fakeChannel,
	resetBaochipConfig,
	tmpDir,
	useSandbox,
	writeUf2,
} from './helpers';

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

	teardown(async () => {
		await resetBaochipConfig();
		cleanupTmpDirs();
	});

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
		sandbox.stub(logService, 'getBaochipChannel').returns(chan);
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const ok = await convertElfToUf2(root, ['hello']);

		assert.equal(ok, false);
		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('conversion failed')),
			'failure toast shown',
		);
		assert.ok(
			lines.some((l) => l.includes('spawn xous-app-uf2 ENOENT')),
			'the spawn error reason is written to the Baochip channel the toast points at',
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

		assert.equal(await convertElfToUf2(root, ['hello']), true);
	});

	test('convertElfToUf2 warns at build time when the app overflows the dabao app region', async () => {
		const root = fakeOotProject('my_oot_app');
		await vscode.workspace
			.getConfiguration('baochip')
			.update('buildTarget', 'dabao', vscode.ConfigurationTarget.Workspace);
		sandbox.stub(procService, 'runProcess').callsFake(async () => {
			writeUf2(path.join(root, 'apps.uf2'), DABAO_APP_START, DABAO_APP_UF2_LIMIT + 4096);
			return { code: 0, stdout: '', stderr: '', cancelled: false };
		});
		const { lines, chan } = fakeChannel();
		sandbox.stub(logService, 'getBaochipChannel').returns(chan);
		const warnings = sandbox.stub(
			vscode.window,
			'showWarningMessage',
		) as unknown as sinon.SinonStub;

		const ok = await convertElfToUf2(root, ['hello']);

		assert.equal(ok, true, 'the conversion itself succeeded; the size warning is advisory');
		assert.ok(
			warnings
				.getCalls()
				.some((c) => String(c.args[0]).includes('4.0 KB over the 1.70 MB limit for dabao')),
			`oversize warning shown: ${warnings.getCalls().map((c) => String(c.args[0]))}`,
		);
		assert.ok(
			lines.some((l) =>
				l.includes(
					`apps.uf2: ${DABAO_APP_UF2_LIMIT + 4096} bytes (limit ${DABAO_APP_UF2_LIMIT} bytes)`,
				),
			),
			`exact byte counts logged: ${lines.join(' | ')}`,
		);
	});
});
