import * as assert from 'node:assert';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as procService from '@services/procService';
import {
	ensureBaoPythonDeps,
	getBaoRunner,
	getGlobalVenvRoot,
	rerunExtensionSetup,
	resetUvSetup,
	setExtensionContext,
} from '@services/uvService';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import { activateExtension, EXT_ID, useSandbox } from './helpers';

// These mirror uvService's private globalState keys; seeding them drives the resolution ladder
// without a real uv install (a saved usable uv short-circuits it, and a matching hash skips it).
const KEY_UV_PATH = 'baochip.uvBinaryPath';
const KEY_UV_PYTHON = 'baochip.uvPythonCommand';
const KEY_REQ_HASH = 'baochip.reqHash';

/** A successful, empty runProcess result. */
const OK = { code: 0, stdout: '', stderr: '', cancelled: false };

interface FakeState {
	get(key: string, def?: unknown): unknown;
	update(key: string, val: unknown): Promise<void>;
	keys(): readonly string[];
}

/**
 * A minimal fake ExtensionContext exposing only what uvService reads: extensionUri (bundled
 * tools/requirements.txt), globalStorageUri (venv root), and a Map-backed globalState. Injected
 * through the exported setExtensionContext so no production code changes to make uvService testable.
 */
function makeUvContext(
	extensionUri: vscode.Uri,
	storagePath: string,
): { context: vscode.ExtensionContext; state: FakeState } {
	const store = new Map<string, unknown>();
	const state: FakeState = {
		get: (key, def) => (store.has(key) ? store.get(key) : def),
		update: (key, val) => {
			if (val === undefined) store.delete(key);
			else store.set(key, val);
			return Promise.resolve();
		},
		keys: () => [...store.keys()],
	};
	const context = {
		extensionUri,
		globalStorageUri: vscode.Uri.file(storagePath),
		globalState: state,
	} as unknown as vscode.ExtensionContext;
	return { context, state };
}

/** sha256 of the bundled requirements.txt - the hash uvService compares against to decide reinstall. */
function bundledReqHash(extRoot: string): string {
	const reqPath = path.join(extRoot, 'resources', 'tools-bao', 'requirements.txt');
	return createHash('sha256').update(fs.readFileSync(reqPath)).digest('hex');
}

suite('uv service orchestration', () => {
	const sandbox = useSandbox();
	let realExtUri: vscode.Uri;
	let realStoragePath: string;
	let tmpStorage: string;
	let state: FakeState;
	let showInfo: sinon.SinonStub;

	suiteSetup(async () => {
		await activateExtension();
		const ext = vscode.extensions.getExtension(EXT_ID);
		if (!ext) throw new Error(`extension not found: ${EXT_ID}`);
		// Capture the real URIs BEFORE any test swaps the context so we can restore them afterwards.
		realExtUri = ext.extensionUri;
		realStoragePath = getGlobalVenvRoot();
	});

	setup(() => {
		tmpStorage = fs.mkdtempSync(path.join(os.tmpdir(), 'bao-uvtest-'));
		const fake = makeUvContext(realExtUri, tmpStorage);
		state = fake.state;
		setExtensionContext(fake.context);
		showInfo = sandbox
			.stub(vscode.window, 'showInformationMessage')
			.resolves(undefined) as unknown as sinon.SinonStub;
	});

	teardown(async () => {
		// Remove the temp storage first so resetUvSetup's "delete .venv?" prompt never fires, then let
		// resetUvSetup settle and clear the module-level uv/deps memos so the next test starts clean.
		fs.rmSync(tmpStorage, { recursive: true, force: true });
		await resetUvSetup();
	});

	suiteTeardown(() => {
		// Restore a context with the real URIs so later suites see the real global storage again.
		setExtensionContext(makeUvContext(realExtUri, realStoragePath).context);
	});

	test('getBaoRunner returns the uv runner and memoizes the resolved binary', async () => {
		// process.execPath (node) stands in for a usable uv: uvUsable only checks that --version exits 0.
		await state.update(KEY_UV_PATH, process.execPath);
		const run = sandbox.stub(procService, 'runProcess').resolves(OK); // guard: no real install

		const first = await getBaoRunner();
		assert.deepEqual(first, { cmd: process.execPath, args: ['run', 'python'] });

		// Clearing the saved path must not change the result: the resolved uv is memoized for the session.
		await state.update(KEY_UV_PATH, undefined);
		const second = await getBaoRunner();
		assert.equal(second.cmd, process.execPath, 'second call served from the in-flight memo');
		assert.ok(run.notCalled, 'a saved usable uv is used directly, nothing is installed');
	});

	test('ensureBaoPythonDeps skips reinstall when the hash is unchanged and the venv exists', async () => {
		const run = sandbox.stub(procService, 'runProcess').resolves(OK);
		const venvDir = path.join(tmpStorage, '.venv');
		fs.mkdirSync(venvDir, { recursive: true });
		fs.writeFileSync(path.join(venvDir, 'pyvenv.cfg'), 'home = fake\n', 'utf8');
		await state.update(KEY_REQ_HASH, bundledReqHash(realExtUri.fsPath));

		await ensureBaoPythonDeps();

		assert.ok(
			run.notCalled,
			'no uv commands run when requirements are unchanged and the venv is present',
		);
	});

	test('ensureBaoPythonDeps creates the venv then installs requirements when the hash changed', async () => {
		await state.update(KEY_UV_PATH, process.execPath); // resolveUvBinary short-circuits to this
		await state.update(KEY_REQ_HASH, 'stale-hash'); // force a mismatch -> install path
		const run = sandbox.stub(procService, 'runProcess').resolves(OK);

		await ensureBaoPythonDeps();

		const calls = run.getCalls();
		const venvCall = calls.find((c) => (c.args[1] as string[])[0] === 'venv');
		const pipCall = calls.find((c) => (c.args[1] as string[]).includes('pip'));
		assert.ok(venvCall, 'uv venv was run');
		assert.ok(pipCall, 'uv pip install was run');
		assert.ok(venvCall.calledBefore(pipCall), 'venv is created before deps are installed');
		assert.equal(venvCall.args[0], process.execPath, 'the resolved uv binary is invoked');
		assert.deepEqual(
			(pipCall.args[1] as string[]).slice(0, 3),
			['pip', 'install', '-r'],
			'deps installed from the requirements file',
		);
		assert.equal(
			state.get(KEY_REQ_HASH),
			bundledReqHash(realExtUri.fsPath),
			'the requirements hash is stamped after a successful install',
		);
	});

	test('ensureBaoPythonDeps surfaces a failed pip install and retries on the next call', async () => {
		await state.update(KEY_UV_PATH, process.execPath);
		await state.update(KEY_REQ_HASH, 'stale-hash');
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		const run = sandbox
			.stub(procService, 'runProcess')
			.callsFake(async (_cmd, args) =>
				(args as string[]).includes('pip')
					? { code: 1, stdout: '', stderr: 'pip boom', cancelled: false }
					: { code: 0, stdout: '', stderr: '', cancelled: false },
			);

		await assert.rejects(ensureBaoPythonDeps(), /pip boom/);
		assert.ok(errors.called, 'the dependency-install failure is surfaced as a toast');
		const afterFirst = run.callCount;

		// A failed run is not cached: the next call retries rather than returning the cached rejection.
		await assert.rejects(ensureBaoPythonDeps());
		assert.ok(
			run.callCount > afterFirst,
			'second call retried the install instead of caching failure',
		);
	});

	test('rerunExtensionSetup reinstalls even when a concurrent command repopulates the deps memo mid-reset', async () => {
		// A usable uv (node stands in) plus a hash-matching venv on disk make ensureBaoPythonDeps take
		// its synchronous skip path, so the "concurrent command" fired below repopulates depsMemo with a
		// RESOLVED promise - the stale state a naive reset would then join, silently skipping reinstall.
		await state.update(KEY_UV_PATH, process.execPath);
		await state.update(KEY_REQ_HASH, bundledReqHash(realExtUri.fsPath));
		const venvDir = path.join(tmpStorage, '.venv');
		fs.mkdirSync(venvDir, { recursive: true });
		fs.writeFileSync(path.join(venvDir, 'pyvenv.cfg'), 'home = fake\n', 'utf8');

		const run = sandbox.stub(procService, 'runProcess').resolves(OK);
		// rerunExtensionSetup gates on a modal confirmation.
		sandbox
			.stub(vscode.window, 'showWarningMessage')
			.resolves('Reinstall' as unknown as vscode.MessageItem);

		// Reproduce the race deterministically: the moment clearUvState clears the saved uv path, a
		// concurrent bao command (e.g. a port-wait probe) fires and repopulates depsMemo via the skip
		// path, then we re-seed the uv path so the post-wipe reinstall can still resolve a usable uv (in
		// production the user's system uv or a fresh install; here the node stand-in).
		let fired = false;
		const realUpdate = state.update.bind(state);
		state.update = async (key: string, val: unknown) => {
			await realUpdate(key, val);
			if (!fired && key === KEY_UV_PATH && val === undefined) {
				fired = true;
				await ensureBaoPythonDeps(); // concurrent probe -> depsMemo resolved (skip path)
				await realUpdate(KEY_UV_PATH, process.execPath); // usable uv remains findable post-wipe
			}
		};

		await rerunExtensionSetup();

		assert.ok(fired, 'the concurrent repopulation was exercised');
		const calls = run.getCalls();
		const venvCall = calls.find((c) => (c.args[1] as string[])[0] === 'venv');
		const pipCall = calls.find((c) => (c.args[1] as string[]).includes('pip'));
		assert.ok(venvCall, 'the reset reinstalled the venv instead of joining the stale deps memo');
		assert.ok(pipCall, 'the reset reinstalled the requirements');
		assert.equal(
			state.get(KEY_REQ_HASH),
			bundledReqHash(realExtUri.fsPath),
			'the requirements hash is stamped after the forced reinstall',
		);
	});

	test('resetUvSetup clears the saved uv state and can delete the cached venv', async () => {
		await state.update(KEY_UV_PATH, process.execPath);
		await state.update(KEY_UV_PYTHON, 'py -3');
		await state.update(KEY_REQ_HASH, 'somehash');
		const venvDir = path.join(tmpStorage, '.venv');
		fs.mkdirSync(venvDir, { recursive: true });
		fs.writeFileSync(path.join(venvDir, 'pyvenv.cfg'), 'home = fake\n', 'utf8');
		showInfo.resolves('Delete .venv');

		await resetUvSetup();

		assert.equal(state.get(KEY_UV_PATH), undefined, 'saved uv path cleared');
		assert.equal(state.get(KEY_UV_PYTHON), undefined, 'saved bootstrap python cleared');
		assert.equal(state.get(KEY_REQ_HASH), undefined, 'requirements hash cleared');
		assert.ok(!fs.existsSync(venvDir), 'cached venv deleted after confirming the prompt');
	});
});
