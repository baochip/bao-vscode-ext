import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as baoRunnerService from '@services/baoRunnerService';
import * as httpService from '@services/httpService';
import * as kernelService from '@services/kernelService';
import { getGlobalVenvRoot } from '@services/uvService';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
	activateExtension,
	cleanupTmpDirs,
	resetBaochipConfig,
	tmpDir,
	useSandbox,
} from './helpers';

const cfg = () => vscode.workspace.getConfiguration('baochip');
const setCfg = (key: string, value: unknown) =>
	cfg().update(key, value, vscode.ConfigurationTarget.Workspace);

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

/** The ci-sync download cache inside the test host's global storage; wiped around each test. */
function kernelCacheDir(): string {
	return path.join(getGlobalVenvRoot(), 'kernel');
}

function wipeKernelCache(): void {
	fs.rmSync(kernelCacheDir(), { recursive: true, force: true });
}

suite('Kernel files service', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	setup(() => {
		wipeKernelCache();
	});

	teardown(async () => {
		await resetBaochipConfig();
		cleanupTmpDirs();
		wipeKernelCache();
	});

	/* ------------------------------ ensureKernelModeConfigured ------------------------------ */

	test('ensureKernelModeConfigured returns a saved mode without prompting', async () => {
		await setCfg('outOfTree.kernelMode', 'manual');
		const info = sandbox.stub(
			vscode.window,
			'showInformationMessage',
		) as unknown as sinon.SinonStub;

		const mode = await kernelService.ensureKernelModeConfigured();

		assert.equal(mode, 'manual');
		assert.ok(info.notCalled, 'no modal for an already-configured mode');
	});

	test('ensureKernelModeConfigured: picking Sync to latest saves ci-sync', async () => {
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'Sync to latest',
		);

		const mode = await kernelService.ensureKernelModeConfigured();

		assert.equal(mode, 'ci-sync');
		assert.equal(cfg().get<string>('outOfTree.kernelMode'), 'ci-sync');
	});

	test('ensureKernelModeConfigured: managing own files asks for a folder and saves both settings', async () => {
		const folder = tmpDir();
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'Manage my own files',
		);
		(sandbox.stub(vscode.window, 'showOpenDialog') as unknown as sinon.SinonStub).resolves([
			vscode.Uri.file(folder),
		]);

		const mode = await kernelService.ensureKernelModeConfigured();

		assert.equal(mode, 'manual');
		assert.equal(cfg().get<string>('outOfTree.kernelMode'), 'manual');
		assert.ok(cfg().get<string>('outOfTree.kernelFilesPath'), 'kernel files path saved');
	});

	test('ensureKernelModeConfigured: cancelling the modal saves nothing', async () => {
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			undefined,
		);

		const mode = await kernelService.ensureKernelModeConfigured();

		assert.equal(mode, undefined);
		assert.equal(cfg().inspect('outOfTree.kernelMode')?.workspaceValue, undefined);
	});

	test('ensureKernelModeConfigured: cancelling the folder pick leaves the mode unset', async () => {
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'Manage my own files',
		);
		(sandbox.stub(vscode.window, 'showOpenDialog') as unknown as sinon.SinonStub).resolves(
			undefined,
		);

		const mode = await kernelService.ensureKernelModeConfigured();

		assert.equal(mode, undefined);
		assert.equal(cfg().inspect('outOfTree.kernelMode')?.workspaceValue, undefined);
	});

	/* ------------------------------ resolveKernelFiles (manual) ------------------------------ */

	test('resolveKernelFiles (manual) errors when no folder is configured', async () => {
		await setCfg('outOfTree.kernelMode', 'manual');
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const files = await kernelService.resolveKernelFiles();

		assert.equal(files, null);
		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('No kernel files folder')),
			'unconfigured-folder error shown',
		);
	});

	test('resolveKernelFiles (manual) errors when loader/xous are missing from the folder', async () => {
		const folder = tmpDir();
		fs.writeFileSync(path.join(folder, 'loader.uf2'), 'loader', 'utf8'); // xous.uf2 absent
		await setCfg('outOfTree.kernelMode', 'manual');
		await setCfg('outOfTree.kernelFilesPath', folder);
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const files = await kernelService.resolveKernelFiles();

		assert.equal(files, null);
		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('Kernel files not found')),
			'missing-files error shown',
		);
	});

	test('resolveKernelFiles (manual) returns the paths when both files exist', async () => {
		const folder = tmpDir();
		fs.writeFileSync(path.join(folder, 'loader.uf2'), 'loader', 'utf8');
		fs.writeFileSync(path.join(folder, 'xous.uf2'), 'xous', 'utf8');
		await setCfg('outOfTree.kernelMode', 'manual');
		await setCfg('outOfTree.kernelFilesPath', folder);

		const files = await kernelService.resolveKernelFiles();

		assert.deepEqual(files, {
			loader: path.join(folder, 'loader.uf2'),
			xous: path.join(folder, 'xous.uf2'),
		});
	});

	/* ------------------------------ resolveKernelFiles (ci-sync) ------------------------------ */

	function stubEtags(loader: string | null, xous: string | null) {
		sandbox
			.stub(httpService, 'fetchETag')
			.callsFake((url: string) => Promise.resolve(url.includes('loader') ? loader : xous));
	}

	test('resolveKernelFiles (ci-sync) downloads both files into the cache and stores etags', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		const download = sandbox.stub(httpService, 'downloadFile').resolves();
		stubEtags('etag-loader', 'etag-xous');

		const files = await kernelService.resolveKernelFiles();

		const cache = kernelCacheDir();
		assert.deepEqual(files, {
			loader: path.join(cache, 'loader.uf2'),
			xous: path.join(cache, 'xous.uf2'),
		});
		assert.equal(download.callCount, 2, 'both kernel files downloaded');
		const urls = download.getCalls().map((c) => c.args[0]);
		assert.ok(
			urls.some((u) => u.endsWith('/loader.uf2')) && urls.some((u) => u.endsWith('/xous.uf2')),
		);
		const etags = JSON.parse(fs.readFileSync(path.join(cache, 'etags.json'), 'utf8'));
		assert.deepEqual(etags, { loader: 'etag-loader', xous: 'etag-xous' });
	});

	function seedKernelCache(etags: { loader: string; xous: string }) {
		const cache = kernelCacheDir();
		fs.mkdirSync(cache, { recursive: true });
		fs.writeFileSync(path.join(cache, 'loader.uf2'), 'cached loader', 'utf8');
		fs.writeFileSync(path.join(cache, 'xous.uf2'), 'cached xous', 'utf8');
		fs.writeFileSync(path.join(cache, 'etags.json'), JSON.stringify(etags), 'utf8');
	}

	test('resolveKernelFiles (ci-sync) skips the download when etags match the cache', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		seedKernelCache({ loader: 'e1', xous: 'e2' });
		const download = sandbox.stub(httpService, 'downloadFile').resolves();
		stubEtags('e1', 'e2');

		const files = await kernelService.resolveKernelFiles();

		assert.ok(files, 'cache used');
		assert.ok(download.notCalled, 'no download when the cache is current');
	});

	test('resolveKernelFiles (ci-sync) uses the cache when etag checks fail (offline)', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		seedKernelCache({ loader: 'e1', xous: 'e2' });
		const download = sandbox.stub(httpService, 'downloadFile').resolves();
		stubEtags(null, null);

		const files = await kernelService.resolveKernelFiles();

		assert.ok(files, 'cache used offline');
		assert.ok(download.notCalled, 'no download attempted offline with a cache');
	});

	test('resolveKernelFiles (ci-sync) surfaces a download failure and returns null', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		sandbox.stub(httpService, 'downloadFile').rejects(new Error('HTTP 503'));
		stubEtags('e1', 'e2');
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const files = await kernelService.resolveKernelFiles();

		assert.equal(files, null);
		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('Failed to download kernel files')),
			'download-failure error shown',
		);
	});

	/* ------------------------------ fetchLatestXousCoreRev ------------------------------ */

	test('fetchLatestXousCoreRev returns the sha from the GitHub API', async () => {
		sandbox.stub(httpService, 'fetchJson').resolves({ sha: SHA });

		assert.equal(await kernelService.fetchLatestXousCoreRev(), SHA);
	});

	test('fetchLatestXousCoreRev rejects an unexpected API response', async () => {
		sandbox.stub(httpService, 'fetchJson').resolves({ message: 'rate limited' });

		await assert.rejects(
			kernelService.fetchLatestXousCoreRev(),
			/Unexpected response from GitHub API/,
		);
	});

	/* ------------------------------ ensureOutOfTreeBuildSetup ------------------------------ */

	test('ensureOutOfTreeBuildSetup (manual) succeeds without touching the network', async () => {
		await setCfg('outOfTree.kernelMode', 'manual');
		const fetchJson = sandbox.stub(httpService, 'fetchJson');
		const runBao = sandbox.stub(baoRunnerService, 'runBaoCmd');

		const ok = await kernelService.ensureOutOfTreeBuildSetup(tmpDir());

		assert.equal(ok, true);
		assert.ok(fetchJson.notCalled && runBao.notCalled, 'no rev fetch or Cargo.toml update');
	});

	test('ensureOutOfTreeBuildSetup (ci-sync) updates the Cargo.toml rev via bao.py', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		sandbox.stub(httpService, 'fetchJson').resolves({ sha: SHA });
		const runBao = sandbox.stub(baoRunnerService, 'runBaoCmd').resolves('');
		const root = tmpDir();

		const ok = await kernelService.ensureOutOfTreeBuildSetup(root);

		assert.equal(ok, true);
		assert.deepEqual(runBao.firstCall.args[0], [
			'app',
			'update-rev',
			'--file',
			path.join(root, 'Cargo.toml'),
			'--rev',
			SHA,
		]);
	});

	test('ensureOutOfTreeBuildSetup (ci-sync) fails when the rev fetch fails', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		sandbox.stub(httpService, 'fetchJson').rejects(new Error('offline'));
		const runBao = sandbox.stub(baoRunnerService, 'runBaoCmd');
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const ok = await kernelService.ensureOutOfTreeBuildSetup(tmpDir());

		assert.equal(ok, false);
		assert.ok(runBao.notCalled, 'no Cargo.toml update after a failed fetch');
		assert.ok(
			errors
				.getCalls()
				.some((c) => String(c.args[0]).includes('Failed to fetch latest xous-core rev')),
			'fetch-failure error shown',
		);
	});

	test('ensureOutOfTreeBuildSetup (ci-sync) fails when update-rev fails', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		sandbox.stub(httpService, 'fetchJson').resolves({ sha: SHA });
		sandbox.stub(baoRunnerService, 'runBaoCmd').rejects(new Error('no dependency found'));
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const ok = await kernelService.ensureOutOfTreeBuildSetup(tmpDir());

		assert.equal(ok, false);
		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('Failed to update xous-core rev')),
			'update-failure error shown',
		);
	});
});
