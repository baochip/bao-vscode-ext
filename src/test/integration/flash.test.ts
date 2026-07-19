import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Commands } from '@commands/commandIds';
import { XOUS_TARGET_TRIPLE } from '@constants';
import * as appService from '@services/appService';
import * as buildService from '@services/buildService';
import * as flashService from '@services/flashService';
import * as logService from '@services/logService';
import * as procService from '@services/procService';
import * as projectModeService from '@services/projectModeService';
import * as xousCoreService from '@services/xousCoreService';
import { realPath } from '@util/fsUtil';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
	activateExtension,
	cleanupTmpDirs,
	fakeChannel,
	makeFakeXousCore,
	resetBaochipConfig,
	tmpDir,
	useSandbox,
} from './helpers';

// NOTE: these tests assume no real BAOCHIP volume is mounted while they run - the flash
// location flows try OS drive auto-detection first, and a live drive would win over the
// stubbed dialogs.

const cfg = () => vscode.workspace.getConfiguration('baochip');
const setCfg = (key: string, value: unknown) =>
	cfg().update(key, value, vscode.ConfigurationTarget.Workspace);

suite('Flash service', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	teardown(async () => {
		await resetBaochipConfig();
		cleanupTmpDirs();
	});

	/* ------------------------------ flash command ------------------------------ */

	test('the Flash command flashes without an app configured (app is a build-time concern)', async () => {
		sandbox.stub(projectModeService, 'getProjectMode').returns('xous-core');
		sandbox.stub(xousCoreService, 'resolveXousRootOrNotify').resolves('C:\\fake\\xous-core');
		sandbox.stub(buildService, 'ensureBuildTargetOrPrompt').resolves('dabao');
		const flash = sandbox.stub(flashService, 'decideAndFlash').resolves(true);
		const pickApp = sandbox.stub(appService, 'promptAndSaveApp');

		await vscode.commands.executeCommand(Commands.flash);

		assert.ok(flash.calledOnce, 'flash proceeded');
		assert.ok(pickApp.notCalled, 'no app picker for a flash');
	});

	/* ------------------------------ ensureFlashLocation ------------------------------ */

	test('ensureFlashLocation returns a saved location that exists, without prompting', async () => {
		const dest = tmpDir();
		await setCfg('flashLocation', dest);
		const info = sandbox.stub(
			vscode.window,
			'showInformationMessage',
		) as unknown as sinon.SinonStub;

		const result = await flashService.ensureFlashLocation();

		assert.equal(result, dest);
		assert.ok(info.notCalled, 'no prompt when the saved location exists');
	});

	test('ensureFlashLocation: unset location prompts for a folder and saves it', async () => {
		const dest = tmpDir();
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'Select Folder',
		);
		(sandbox.stub(vscode.window, 'showOpenDialog') as unknown as sinon.SinonStub).resolves([
			vscode.Uri.file(dest),
		]);

		const result = await flashService.ensureFlashLocation();

		assert.ok(result, 'a location was returned');
		assert.equal(realPath(result), realPath(dest));
		assert.ok(cfg().get<string>('flashLocation'), 'location persisted');
	});

	test('ensureFlashLocation: cancelling the mount confirmation returns undefined', async () => {
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			undefined,
		);

		const result = await flashService.ensureFlashLocation();

		assert.equal(result, undefined);
		assert.equal(cfg().get<string>('flashLocation') || '', '', 'nothing saved');
	});

	test('ensureFlashLocation: missing saved location offers Select New Location and re-saves', async () => {
		await setCfg('flashLocation', path.join(tmpDir(), 'gone'));
		const newDest = tmpDir();
		(sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub).resolves(
			'Select New Location',
		);
		(sandbox.stub(vscode.window, 'showOpenDialog') as unknown as sinon.SinonStub).resolves([
			vscode.Uri.file(newDest),
		]);

		const result = await flashService.ensureFlashLocation();

		assert.ok(result, 'a location was returned');
		assert.equal(realPath(result), realPath(newDest));
	});

	test('ensureFlashLocation: an inaccessible re-picked location errors and returns undefined', async () => {
		await setCfg('flashLocation', path.join(tmpDir(), 'gone'));
		(sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub).resolves(
			'Select New Location',
		);
		(sandbox.stub(vscode.window, 'showOpenDialog') as unknown as sinon.SinonStub).resolves([
			vscode.Uri.file(path.join(tmpDir(), 'also-gone')),
		]);
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const result = await flashService.ensureFlashLocation();

		assert.equal(result, undefined);
		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('not accessible')),
			'inaccessible-location error shown',
		);
	});

	test('ensureFlashLocation: Continue succeeds once the drive appears', async () => {
		const parent = tmpDir();
		const dest = path.join(parent, 'BAOCHIP');
		await setCfg('flashLocation', dest);
		(sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub).callsFake(
			async () => {
				fs.mkdirSync(dest); // the user presses RESET and the drive mounts
				return 'Continue';
			},
		);

		const result = await flashService.ensureFlashLocation();

		assert.equal(result, dest);
	});

	test('ensureFlashLocation: dismissing the missing-drive warning returns undefined', async () => {
		await setCfg('flashLocation', path.join(tmpDir(), 'gone'));
		(sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub).resolves(
			undefined,
		);

		const result = await flashService.ensureFlashLocation();

		assert.equal(result, undefined);
	});

	test('ensureFlashLocation: win32 auto-detects a BAOCHIP drive without prompting', async () => {
		sandbox.stub(process, 'platform').value('win32');
		const run = sandbox
			.stub(procService, 'runProcess')
			.resolves({ code: 0, stdout: 'E\r\n', stderr: '', cancelled: false });
		const info = sandbox.stub(
			vscode.window,
			'showInformationMessage',
		) as unknown as sinon.SinonStub;

		const result = await flashService.ensureFlashLocation();

		assert.equal(result, 'E:\\', 'detected drive letter mapped to a path');
		assert.equal(cfg().get<string>('flashLocation'), 'E:\\', 'detected location persisted');
		assert.ok(run.calledOnce, 'the Get-Volume probe ran once');
		assert.ok(info.notCalled, 'no mount prompt when a drive is detected');
	});

	test('ensureFlashLocation: win32 falls through to the mount prompt when detection fails', async () => {
		sandbox.stub(process, 'platform').value('win32');
		const run = sandbox.stub(procService, 'runProcess').resolves({
			code: null,
			stdout: '',
			stderr: '',
			error: new Error('spawn ENOENT'),
			cancelled: false,
		});
		const info = (
			sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub
		).resolves(undefined); // dismiss the mount confirmation

		const result = await flashService.ensureFlashLocation();

		assert.equal(result, undefined);
		assert.ok(run.calledOnce, 'detection was attempted');
		assert.ok(
			info.getCalls().some((c) => String(c.args[0]).includes('baochip is mounted')),
			'mount confirmation prompt shown after detection failed',
		);
	});

	/* ------------------------------ gatherArtifacts ------------------------------ */

	test('gatherArtifacts maps roles and skips absent files', async () => {
		const root = tmpDir();
		const releaseDir = path.join(root, 'target', XOUS_TARGET_TRIPLE, 'release');
		fs.mkdirSync(releaseDir, { recursive: true });
		fs.writeFileSync(path.join(releaseDir, 'xous.uf2'), 'xous image', 'utf8');

		const { byRole, all } = await flashService.gatherArtifacts(root);

		assert.equal(byRole.xous, path.join(releaseDir, 'xous.uf2'));
		assert.equal(byRole.loader, undefined);
		assert.equal(byRole.apps, undefined);
		assert.deepEqual(all, [path.join(releaseDir, 'xous.uf2')]);
	});

	test('gatherArtifacts includes swap.uf2 for baosec builds (no apps.uf2)', async () => {
		const root = tmpDir();
		const releaseDir = path.join(root, 'target', XOUS_TARGET_TRIPLE, 'release');
		fs.mkdirSync(releaseDir, { recursive: true });
		for (const name of ['loader.uf2', 'xous.uf2', 'swap.uf2']) {
			fs.writeFileSync(path.join(releaseDir, name), name, 'utf8');
		}

		const { byRole, all } = await flashService.gatherArtifacts(root);

		assert.equal(byRole.swap, path.join(releaseDir, 'swap.uf2'));
		assert.equal(byRole.apps, undefined, 'a baosec build has no apps.uf2');
		assert.deepEqual(all, [
			path.join(releaseDir, 'loader.uf2'),
			path.join(releaseDir, 'xous.uf2'),
			path.join(releaseDir, 'swap.uf2'),
		]);
	});

	/* ------------------------------ decideAndFlash ------------------------------ */

	test('decideAndFlash (xous-core) copies all artifacts and verifies by MD5', async () => {
		const { root, releaseDir } = makeFakeXousCore(tmpDir(), { withArtifacts: true });
		const dest = tmpDir();
		await setCfg('flashLocation', dest);
		const { lines, chan } = fakeChannel();
		sandbox.stub(logService, 'getBaochipChannel').returns(chan);
		sandbox.stub(vscode.window, 'showInformationMessage');

		const ok = await flashService.decideAndFlash(root);

		assert.equal(ok, true);
		for (const name of ['loader.uf2', 'xous.uf2', 'apps.uf2']) {
			assert.ok(releaseDir, 'fixture created artifacts');
			assert.deepEqual(
				fs.readFileSync(path.join(dest, name)),
				fs.readFileSync(path.join(releaseDir, name)),
				`${name} copied byte-identically`,
			);
		}
		const verified = lines.filter((l) => l.includes('Verified (MD5 match)')).length;
		assert.equal(verified, 3, `each file verified by MD5: ${lines.join(' | ')}`);
		assert.ok(
			lines.some((l) => l.includes('Flash complete')),
			'completion line logged',
		);
	});

	test('decideAndFlash (xous-core) warns and fails when no artifacts exist', async () => {
		const { root } = makeFakeXousCore(tmpDir()); // no artifacts
		const dest = tmpDir();
		await setCfg('flashLocation', dest);
		const warnings = sandbox.stub(
			vscode.window,
			'showWarningMessage',
		) as unknown as sinon.SinonStub;

		const ok = await flashService.decideAndFlash(root);

		assert.equal(ok, false);
		assert.ok(
			warnings.getCalls().some((c) => String(c.args[0]).includes('No UF2s found')),
			'build-first warning shown',
		);
	});

	test('decideAndFlash (out-of-tree) flashes kernel files plus apps.uf2', async () => {
		const root = tmpDir();
		fs.writeFileSync(path.join(root, 'apps.uf2'), 'apps image', 'utf8');
		const kernelDir = tmpDir();
		const kernelFiles = {
			loader: path.join(kernelDir, 'loader.uf2'),
			xous: path.join(kernelDir, 'xous.uf2'),
		};
		fs.writeFileSync(kernelFiles.loader, 'loader image', 'utf8');
		fs.writeFileSync(kernelFiles.xous, 'xous image', 'utf8');
		const dest = tmpDir();
		await setCfg('flashLocation', dest);
		const { chan } = fakeChannel();
		sandbox.stub(logService, 'getBaochipChannel').returns(chan);
		sandbox.stub(vscode.window, 'showInformationMessage');

		const ok = await flashService.decideAndFlash(root, kernelFiles);

		assert.equal(ok, true);
		assert.equal(fs.readFileSync(path.join(dest, 'loader.uf2'), 'utf8'), 'loader image');
		assert.equal(fs.readFileSync(path.join(dest, 'xous.uf2'), 'utf8'), 'xous image');
		assert.equal(fs.readFileSync(path.join(dest, 'apps.uf2'), 'utf8'), 'apps image');
	});

	test('decideAndFlash (out-of-tree) fails when apps.uf2 is missing', async () => {
		const root = tmpDir(); // no apps.uf2
		const kernelDir = tmpDir();
		const kernelFiles = {
			loader: path.join(kernelDir, 'loader.uf2'),
			xous: path.join(kernelDir, 'xous.uf2'),
		};
		fs.writeFileSync(kernelFiles.loader, 'loader image', 'utf8');
		fs.writeFileSync(kernelFiles.xous, 'xous image', 'utf8');
		await setCfg('flashLocation', tmpDir());
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const ok = await flashService.decideAndFlash(root, kernelFiles);

		assert.equal(ok, false);
		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('apps.uf2 not found')),
			'missing apps.uf2 error shown',
		);
	});

	/* ------------------------------ flashFiles cancellation ------------------------------ */

	test('flashFiles with a cancelled token copies nothing and reports failure', async () => {
		const src = tmpDir();
		const srcFile = path.join(src, 'loader.uf2');
		fs.writeFileSync(srcFile, 'loader image', 'utf8');
		const dest = tmpDir();
		const cancelledToken: vscode.CancellationToken = {
			isCancellationRequested: true,
			onCancellationRequested: () => ({ dispose: () => {} }),
		};
		sandbox
			.stub(vscode.window, 'withProgress')
			.callsFake((_opts, task) =>
				task({ report: () => {} }, cancelledToken),
			) as unknown as sinon.SinonStub;
		const { chan } = fakeChannel();
		sandbox.stub(logService, 'getBaochipChannel').returns(chan);
		const warnings = sandbox.stub(
			vscode.window,
			'showWarningMessage',
		) as unknown as sinon.SinonStub;

		const ok = await flashService.flashFiles(dest, [srcFile]);

		assert.equal(ok, false);
		assert.ok(!fs.existsSync(path.join(dest, 'loader.uf2')), 'nothing copied');
		assert.ok(
			warnings.getCalls().some((c) => String(c.args[0]).includes('Flash cancelled')),
			'cancellation warning shown',
		);
	});

	test('flashFiles logs the failure to the Baochip channel, not just a toast', async () => {
		const dest = tmpDir();
		const missingSrc = path.join(tmpDir(), 'nope.uf2'); // unreadable source makes the copy throw
		const { lines, chan } = fakeChannel();
		sandbox.stub(logService, 'getBaochipChannel').returns(chan);
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const ok = await flashService.flashFiles(dest, [missingSrc]);

		assert.equal(ok, false);
		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('Baochip flash failed')),
			'failure toast shown',
		);
		assert.ok(
			lines.some((l) => l.includes('Flash failed')),
			`failure recorded in the Baochip channel: ${lines.join(' | ')}`,
		);
	});
});
