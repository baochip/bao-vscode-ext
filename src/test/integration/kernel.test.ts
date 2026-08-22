import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { XOUS_CORE_REPO } from '@constants';
import * as baoRunnerService from '@services/baoRunnerService';
import * as httpService from '@services/httpService';
import * as kernelService from '@services/kernelService';
import * as logService from '@services/logService';
import * as procService from '@services/procService';
import * as uvService from '@services/uvService';
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

/** The ci-sync download cache for a board, inside the test host's global storage. */
function kernelCacheDir(target = 'dabao'): string {
	return path.join(uvService.getGlobalVenvRoot(), 'kernel', target);
}

/** Wipes every board's cache, so one test's download cannot answer another's. */
function wipeKernelCache(): void {
	fs.rmSync(path.join(uvService.getGlobalVenvRoot(), 'kernel'), { recursive: true, force: true });
}

/** An out-of-tree root whose manifest pins xous-core, so the rev sync has something to update. */
function ootRootWithXousDep(): string {
	const root = tmpDir();
	fs.writeFileSync(
		path.join(root, 'Cargo.toml'),
		`[package]
name = "hello"

[dependencies]
bao1x-api = { git = "${XOUS_CORE_REPO}", rev = "old" }
`,
		'utf8',
	);
	return root;
}

suite('Kernel files service', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	setup(async () => {
		wipeKernelCache();
		// CI kernels are dabao-only, so these tests run as a user who has picked that board.
		await setCfg('buildTarget', 'dabao');
	});

	teardown(async () => {
		await resetBaochipConfig();
		cleanupTmpDirs();
		wipeKernelCache();
	});

	/* ------------------------------ fetchLatestXousCoreRev ------------------------------ */

	test('fetchLatestXousCoreRev returns a well-formed sha', async () => {
		sandbox.stub(httpService, 'fetchJson').resolves({ sha: SHA });

		assert.equal(await kernelService.fetchLatestXousCoreRev(), SHA);
	});

	test('fetchLatestXousCoreRev rejects a sha that is not plain hex', async () => {
		// the value gets spliced into Cargo.toml via String.replace, so shape matters
		sandbox.stub(httpService, 'fetchJson').resolves({ sha: 'abcdef1$&`beef00' });

		await assert.rejects(kernelService.fetchLatestXousCoreRev(), /Unexpected response/);
	});

	test('fetchLatestXousCoreRev rejects an unexpected API response', async () => {
		sandbox.stub(httpService, 'fetchJson').resolves({ message: 'rate limited' });

		await assert.rejects(
			kernelService.fetchLatestXousCoreRev(),
			/Unexpected response from GitHub API/,
		);
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

	/* ------------------------------ resolveKernelFiles (mode not yet chosen) ------------------------------ */

	test('resolveKernelFiles with no mode chosen shows the setup modal; cancel aborts with no download', async () => {
		const info = sandbox.stub(
			vscode.window,
			'showInformationMessage',
		) as unknown as sinon.SinonStub;
		info.resolves(undefined);
		const download = sandbox.stub(httpService, 'downloadFile');
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const files = await kernelService.resolveKernelFiles();

		assert.equal(files, null);
		assert.ok(info.calledOnce, 'setup modal shown before any kernel work');
		assert.ok(download.notCalled, 'no CI kernels downloaded without a chosen mode');
		assert.ok(errors.notCalled, 'clean abort, no error toast');
	});

	test('resolveKernelFiles with no mode chosen: picking Manage my own files continues in the same run', async () => {
		const folder = tmpDir();
		fs.writeFileSync(path.join(folder, 'loader.uf2'), 'l', 'utf8');
		fs.writeFileSync(path.join(folder, 'xous.uf2'), 'x', 'utf8');
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'Manage my own files',
		);
		(sandbox.stub(vscode.window, 'showOpenDialog') as unknown as sinon.SinonStub).resolves([
			vscode.Uri.file(folder),
		]);

		const files = await kernelService.resolveKernelFiles();

		// Compare against the persisted folder (Uri.fsPath can change drive-letter case on Windows).
		const savedFolder = cfg().get<string>('outOfTree.kernelFilesPath') ?? '';
		assert.ok(files, 'kernel files resolved in the same run');
		assert.notEqual(files, 'app-only');
		const kernel = files as { loader: string; xous: string } | null;
		assert.equal(kernel?.loader, path.join(savedFolder, 'loader.uf2'));
		assert.equal(kernel?.xous, path.join(savedFolder, 'xous.uf2'));
		assert.equal(cfg().get<string>('outOfTree.kernelMode'), 'manual', 'choice persisted');
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

	test('resolveKernelFiles (ci-sync) fetches each board from its own CI directory', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		await setCfg('buildTarget', 'baosec');
		const download = sandbox
			.stub(httpService, 'downloadFile')
			.callsFake(async (_url: string, dest: string) => {
				fs.mkdirSync(path.dirname(dest), { recursive: true });
				fs.writeFileSync(dest, 'image', 'utf8');
				return 'etag';
			});
		sandbox.stub(httpService, 'fetchETag').resolves('etag');

		const files = await kernelService.resolveKernelFiles();

		assert.notEqual(files, null, 'baosec syncs like any other board');
		const urls = download.getCalls().map((c) => String(c.args[0]));
		assert.ok(
			urls.every((u) => u.includes('/baochip/baosec/')),
			`downloads come from the baosec directory: ${urls.join(', ')}`,
		);
		const kernel = files as { loader: string; xous: string };
		assert.ok(
			kernel.loader.includes(path.join('kernel', 'baosec')),
			'and are cached apart from another board',
		);
	});

	/* ------------------------------ resolveKernelFiles (ci-sync) ------------------------------ */

	function stubEtags(loader: string | null, xous: string | null) {
		sandbox
			.stub(httpService, 'fetchETag')
			.callsFake((url: string) => Promise.resolve(url.includes('loader') ? loader : xous));
	}

	/** Stub downloadFile to write the cache files and return a per-file ETag from the GET response. */
	function stubDownloadWithEtags(loaderEtag: string | null, xousEtag: string | null) {
		return sandbox.stub(httpService, 'downloadFile').callsFake((url: string, dest: string) => {
			fs.mkdirSync(path.dirname(dest), { recursive: true });
			fs.writeFileSync(dest, 'downloaded', 'utf8');
			return Promise.resolve(url.includes('loader') ? loaderEtag : xousEtag);
		});
	}

	test('resolveKernelFiles (ci-sync) downloads both files and stores the response ETags', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		const download = stubDownloadWithEtags('etag-loader', 'etag-xous');

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

	test('resolveKernelFiles (ci-sync) stores the download-response ETag, not a racing HEAD', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		stubDownloadWithEtags('get-loader', 'get-xous');
		// A CI publish during the download would make a post-download HEAD report newer etags; those
		// must not be stored, or the freshly downloaded pair would be mis-stamped and frozen stale.
		stubEtags('head-loader-newer', 'head-xous-newer');

		await kernelService.resolveKernelFiles();

		const etags = JSON.parse(fs.readFileSync(path.join(kernelCacheDir(), 'etags.json'), 'utf8'));
		assert.deepEqual(
			etags,
			{ loader: 'get-loader', xous: 'get-xous' },
			'GET etags stored, not HEAD',
		);
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

	test('resolveKernelFiles (ci-sync) routes a download failure through the central errorToast', async () => {
		// A caught operation failure must leave a central log trace, not just a transient toast.
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		sandbox.stub(httpService, 'downloadFile').rejects(new Error('HTTP 503'));
		stubEtags('e1', 'e2');
		const errorToast = sandbox.stub(logService, 'errorToast');

		const files = await kernelService.resolveKernelFiles();

		assert.equal(files, null);
		assert.ok(errorToast.calledOnce, 'failure logged and toasted via errorToast');
		assert.ok(String(errorToast.firstCall.args[0]).includes('Failed to download kernel files'));
	});

	test('resolveKernelFiles (ci-sync) aborts without downloading if the stale etags cannot be cleared', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		const cache = kernelCacheDir();
		fs.mkdirSync(cache, { recursive: true });
		// etags.json as a DIRECTORY makes the up-front clear (rmSync, no recursive) throw; the download
		// must abort BEFORE writing any file rather than leave a stale etags an offline flash would trust.
		fs.mkdirSync(path.join(cache, 'etags.json'));
		const download = sandbox.stub(httpService, 'downloadFile').resolves();
		stubEtags('new-l', 'new-x');
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const files = await kernelService.resolveKernelFiles();

		assert.equal(files, null, 'aborted, no kernel files resolved');
		assert.ok(download.notCalled, 'no file downloaded once the clear failed');
		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('Failed to download kernel files')),
			'download-failure error shown',
		);
	});

	test('resolveKernelFiles (ci-sync) invalidates the stored etags when a re-download fails partway', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		seedKernelCache({ loader: 'old-l', xous: 'old-x' }); // coherent cached pair + etags
		const cache = kernelCacheDir();
		// CI has moved on, so the etag check triggers a re-download...
		stubEtags('new-l', 'new-x');
		// ...but the second file (xous) fails, leaving loader new and xous old on disk.
		const download = sandbox.stub(httpService, 'downloadFile');
		download.onFirstCall().resolves();
		download.onSecondCall().rejects(new Error('ECONNRESET'));
		sandbox.stub(vscode.window, 'showErrorMessage');

		const files = await kernelService.resolveKernelFiles();

		assert.equal(files, null, 'the failed download aborts this flash');
		assert.equal(
			fs.existsSync(path.join(cache, 'etags.json')),
			false,
			'stale etags invalidated so the incoherent pair is never trusted later',
		);
	});

	test('resolveKernelFiles (ci-sync) re-downloads a cache with no etags file (incomplete download)', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		// Cache files present but NO etags.json - the state left by a failed partial download; the
		// pair may be incoherent, so it must not be trusted even offline.
		const cache = kernelCacheDir();
		fs.mkdirSync(cache, { recursive: true });
		fs.writeFileSync(path.join(cache, 'loader.uf2'), 'maybe-mixed loader', 'utf8');
		fs.writeFileSync(path.join(cache, 'xous.uf2'), 'maybe-mixed xous', 'utf8');
		stubEtags(null, null); // offline: etag HEADs fail
		const download = stubDownloadWithEtags(null, null);

		const files = await kernelService.resolveKernelFiles();

		assert.ok(download.called, 'the untrusted cache is re-downloaded rather than flashed as-is');
		assert.ok(files, 'a successful re-download resolves the files');
	});

	test('resolveKernelFiles (ci-sync) uses a completed cache even when CI serves no ETags', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		// A completed prior download for which CI provided no etags: files present + an EMPTY (but
		// existing) etags.json. This coherent cache must be used, not re-downloaded every flash or
		// hard-failed offline.
		const cache = kernelCacheDir();
		fs.mkdirSync(cache, { recursive: true });
		fs.writeFileSync(path.join(cache, 'loader.uf2'), 'cached loader', 'utf8');
		fs.writeFileSync(path.join(cache, 'xous.uf2'), 'cached xous', 'utf8');
		fs.writeFileSync(path.join(cache, 'etags.json'), '{}', 'utf8'); // completed, no etags
		stubEtags(null, null); // CI serves no etags (offline behaves identically)
		const download = sandbox.stub(httpService, 'downloadFile').resolves(null);

		const files = await kernelService.resolveKernelFiles();

		assert.ok(files, 'the completed cache is used');
		assert.ok(download.notCalled, 'no re-download or hard-fail when etags cannot be validated');
	});

	/* ------------------------------ ensureOutOfTreeBuildSetup ------------------------------ */

	test('ensureOutOfTreeBuildSetup (manual) succeeds without touching the network', async () => {
		await setCfg('outOfTree.kernelMode', 'manual');
		const fetchJson = sandbox.stub(httpService, 'fetchJson');
		const runBao = sandbox.stub(baoRunnerService, 'runBaoCmd');

		const ok = await kernelService.ensureOutOfTreeBuildSetup(tmpDir(), ['hello']);

		assert.equal(ok, true);
		assert.ok(fetchJson.notCalled && runBao.notCalled, 'no rev fetch or Cargo.toml update');
	});

	test('ensureOutOfTreeBuildSetup (ci-sync) updates the Cargo.toml rev via bao.py', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		sandbox.stub(httpService, 'fetchJson').resolves({ sha: SHA });
		const runBao = sandbox.stub(baoRunnerService, 'runBaoCmd').resolves('');
		const root = ootRootWithXousDep();

		const ok = await kernelService.ensureOutOfTreeBuildSetup(root, ['hello']);

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

	test('ensureOutOfTreeBuildSetup (ci-sync) updates only the selected crates', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		sandbox.stub(httpService, 'fetchJson').resolves({ sha: SHA });
		const runBao = sandbox.stub(baoRunnerService, 'runBaoCmd').resolves('');

		const root = tmpDir();
		fs.writeFileSync(path.join(root, 'Cargo.toml'), `[workspace]\nmembers = ["a", "b"]\n`, 'utf8');
		for (const name of ['a', 'b']) {
			fs.mkdirSync(path.join(root, name), { recursive: true });
			fs.writeFileSync(
				path.join(root, name, 'Cargo.toml'),
				`[package]
name = "${name}"

[dependencies]
bao1x-api = { git = "${XOUS_CORE_REPO}", rev = "old" }
`,
				'utf8',
			);
		}

		const ok = await kernelService.ensureOutOfTreeBuildSetup(root, ['a']);

		assert.equal(ok, true);
		const files = runBao.getCalls().map((c) => (c.args[0] as string[])[3]);
		assert.deepEqual(files, [path.join(root, 'a', 'Cargo.toml')], 'only the selected crate');
	});

	test('ensureOutOfTreeBuildSetup (ci-sync) skips a crate with no xous-core dependency', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		sandbox.stub(httpService, 'fetchJson').resolves({ sha: SHA });
		const runBao = sandbox.stub(baoRunnerService, 'runBaoCmd').resolves('');

		const root = tmpDir();
		fs.writeFileSync(path.join(root, 'Cargo.toml'), `[workspace]\nmembers = ["plain"]\n`, 'utf8');
		fs.mkdirSync(path.join(root, 'plain'), { recursive: true });
		fs.writeFileSync(
			path.join(root, 'plain', 'Cargo.toml'),
			`[package]\nname = "plain"\n\n[dependencies]\nlog = "0.4"\n`,
			'utf8',
		);

		const ok = await kernelService.ensureOutOfTreeBuildSetup(root, ['plain']);

		assert.equal(ok, true, 'nothing to update is success, not failure');
		assert.ok(runBao.notCalled, 'update-rev would error on a manifest with no xous-core dep');
	});

	test('ensureOutOfTreeBuildSetup (ci-sync) fails when the rev fetch fails', async () => {
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		sandbox.stub(httpService, 'fetchJson').rejects(new Error('offline'));
		const runBao = sandbox.stub(baoRunnerService, 'runBaoCmd');
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const ok = await kernelService.ensureOutOfTreeBuildSetup(tmpDir(), ['hello']);

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

		const ok = await kernelService.ensureOutOfTreeBuildSetup(ootRootWithXousDep(), ['hello']);

		assert.equal(ok, false);
		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('Failed to update xous-core rev')),
			'update-failure error shown',
		);
	});

	test('ensureOutOfTreeBuildSetup (ci-sync) shows a single toast when update-rev fails', async () => {
		// Drive the real runBaoCmd (only the process is stubbed) so its quiet flag is exercised:
		// runBaoCmd must stay silent so the caller's specific toast is the only one.
		await setCfg('outOfTree.kernelMode', 'ci-sync');
		sandbox.stub(httpService, 'fetchJson').resolves({ sha: SHA });
		sandbox.stub(uvService, 'getBaoRunner').resolves({ cmd: 'uv', args: ['run', 'python'] });
		sandbox.stub(uvService, 'ensureBaoPythonDeps').resolves();
		sandbox
			.stub(procService, 'runProcess')
			.resolves({ code: 2, stdout: '', stderr: 'no dependency found', cancelled: false });
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const ok = await kernelService.ensureOutOfTreeBuildSetup(ootRootWithXousDep(), ['hello']);

		assert.equal(ok, false);
		assert.equal(
			errors.callCount,
			1,
			'exactly one error toast, not one from runBaoCmd plus one here',
		);
		assert.ok(
			String(errors.firstCall.args[0]).includes('Failed to update xous-core rev'),
			'the single toast is the caller-specific message',
		);
	});
});
