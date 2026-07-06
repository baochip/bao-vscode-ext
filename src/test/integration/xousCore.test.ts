import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as cloneXousCoreModule from '@services/cloneXousCore';
import { getProjectMode } from '@services/projectModeService';
import { ensureXousWorkspaceOpen } from '@services/workspaceService';
import * as xousCoreService from '@services/xousCoreService';
import { realPath } from '@util/fsUtil';
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

function workspaceRoot(): string {
	const folder = vscode.workspace.workspaceFolders?.[0];
	assert.ok(folder, 'test host has a workspace folder');
	return folder.uri.fsPath;
}

/** apps-dabao inside the fixture workspace makes auto-detection see it as xous-core. */
function fixtureAppsDir(): string {
	return path.join(workspaceRoot(), 'apps-dabao');
}

suite('Project mode and xous-core resolution', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	teardown(async () => {
		fs.rmSync(fixtureAppsDir(), { recursive: true, force: true });
		await resetBaochipConfig();
		cleanupTmpDirs();
	});

	/* ------------------------------ getProjectMode ------------------------------ */

	test('getProjectMode: an explicit setting wins over workspace detection', async () => {
		fs.mkdirSync(fixtureAppsDir(), { recursive: true });
		await setCfg('buildMode', 'out-of-tree');
		assert.equal(getProjectMode(), 'out-of-tree', 'out-of-tree wins despite apps-dabao');

		fs.rmSync(fixtureAppsDir(), { recursive: true, force: true });
		await setCfg('buildMode', 'xous-core');
		assert.equal(getProjectMode(), 'xous-core', 'xous-core wins without apps-dabao');
	});

	test('getProjectMode: auto resolves by the presence of an apps directory', async () => {
		await setCfg('buildMode', 'auto');
		assert.equal(getProjectMode(), 'out-of-tree', 'no apps dir means out-of-tree');

		fs.mkdirSync(fixtureAppsDir(), { recursive: true });
		assert.equal(getProjectMode(), 'xous-core', 'apps-dabao flips auto to xous-core');
	});

	/* ------------------------------ autoDetectXousCore ------------------------------ */

	test('autoDetectXousCore saves the workspace root when unset and detectable', async () => {
		fs.mkdirSync(fixtureAppsDir(), { recursive: true });

		await xousCoreService.autoDetectXousCore();

		assert.equal(realPath(cfg().get<string>('xousCorePath') || ''), realPath(workspaceRoot()));
	});

	test('autoDetectXousCore leaves a valid configured path alone', async () => {
		const configured = tmpDir();
		await setCfg('xousCorePath', configured);
		fs.mkdirSync(fixtureAppsDir(), { recursive: true });

		await xousCoreService.autoDetectXousCore();

		assert.equal(cfg().get<string>('xousCorePath'), configured, 'existing setting kept');
	});

	/* ------------------------------ ensureXousCorePath ------------------------------ */

	test('ensureXousCorePath returns a valid configured path without prompting', async () => {
		const configured = tmpDir();
		await setCfg('xousCorePath', configured);
		const info = sandbox.stub(
			vscode.window,
			'showInformationMessage',
		) as unknown as sinon.SinonStub;

		const root = await xousCoreService.ensureXousCorePath();

		assert.equal(root, configured);
		assert.ok(info.notCalled, 'no modal for a valid configured path');
	});

	test('ensureXousCorePath re-detects from the workspace when the saved path is stale', async () => {
		await setCfg('xousCorePath', path.join(tmpDir(), 'deleted-xous-core'));
		fs.mkdirSync(fixtureAppsDir(), { recursive: true });

		const root = await xousCoreService.ensureXousCorePath();

		assert.equal(realPath(root), realPath(workspaceRoot()));
		assert.equal(realPath(cfg().get<string>('xousCorePath') || ''), realPath(workspaceRoot()));
	});

	test('ensureXousCorePath: cancelling the modal throws "not set"', async () => {
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			undefined,
		);

		await assert.rejects(xousCoreService.ensureXousCorePath(), /xous-core path not set/);
	});

	test('ensureXousCorePath: Select Folder saves and returns the picked folder', async () => {
		const picked = tmpDir();
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'Select Folder',
		);
		(sandbox.stub(vscode.window, 'showOpenDialog') as unknown as sinon.SinonStub).resolves([
			vscode.Uri.file(picked),
		]);

		const root = await xousCoreService.ensureXousCorePath();

		assert.equal(realPath(root), realPath(picked));
		assert.ok(cfg().get<string>('xousCorePath'), 'picked path persisted');
	});

	test('ensureXousCorePath: Clone from GitHub saves the cloned folder', async () => {
		const cloned = tmpDir();
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'Clone from GitHub',
		);
		sandbox.stub(cloneXousCoreModule, 'cloneXousCore').resolves(cloned);

		const root = await xousCoreService.ensureXousCorePath();

		assert.equal(root, cloned);
		assert.equal(cfg().get<string>('xousCorePath'), cloned);
	});

	test('ensureXousCorePath: an incomplete clone throws', async () => {
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'Clone from GitHub',
		);
		sandbox.stub(cloneXousCoreModule, 'cloneXousCore').resolves(undefined);

		await assert.rejects(xousCoreService.ensureXousCorePath(), /Clone did not complete/);
	});

	test('ensureXousCorePath: Open Repo Page opens the browser and throws guidance', async () => {
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'Open Repo Page',
		);
		const openExternal = sandbox.stub(vscode.env, 'openExternal').resolves(true);

		await assert.rejects(xousCoreService.ensureXousCorePath(), /clone locally, then try again/);
		assert.ok(openExternal.calledOnce, 'repo page opened');
		assert.ok(
			String(openExternal.firstCall.args[0]).includes('github.com/betrusted-io/xous-core'),
			'opens the xous-core repo',
		);
	});

	test('resolveXousRootOrNotify turns the failure into a toast and undefined', async () => {
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			undefined,
		);
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const root = await xousCoreService.resolveXousRootOrNotify();

		assert.equal(root, undefined);
		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('xous-core path not set')),
			'failure surfaced as a toast',
		);
	});

	/* ------------------------------ ensureXousFolderOpen ------------------------------ */

	test('ensureXousFolderOpen is ready when the exact root is open', async () => {
		assert.equal(await xousCoreService.ensureXousFolderOpen(workspaceRoot()), 'ready');
	});

	test('ensureXousFolderOpen is ready when the open folder covers or is covered by the root', async () => {
		// A child of the open workspace folder counts as open.
		const child = path.join(workspaceRoot(), 'nested-xous-core');
		fs.mkdirSync(child, { recursive: true });
		try {
			assert.equal(await xousCoreService.ensureXousFolderOpen(child), 'ready');
		} finally {
			fs.rmSync(child, { recursive: true, force: true });
		}

		// A parent of the open workspace folder counts as open too (F4b behavior).
		const parent = path.dirname(workspaceRoot());
		assert.equal(await xousCoreService.ensureXousFolderOpen(parent), 'ready');
	});

	test('ensureXousFolderOpen: Add to Workspace adds the folder and continues', async () => {
		const root = tmpDir();
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'Add to Workspace',
		);
		const updateFolders = sandbox.stub(vscode.workspace, 'updateWorkspaceFolders').returns(true);

		const state = await xousCoreService.ensureXousFolderOpen(root);

		assert.equal(state, 'added');
		assert.ok(updateFolders.calledOnce, 'folder added');
		const folderArg = updateFolders.firstCall.args[2] as { uri: vscode.Uri };
		assert.equal(folderArg.uri.fsPath.toLowerCase(), root.toLowerCase());
	});

	test('ensureXousFolderOpen: Open Here reopens the window and reports reopen', async () => {
		const root = tmpDir();
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'Open Here',
		);
		// The real vscode.openFolder would reload the test window; stub the command router.
		const exec = sandbox.stub(vscode.commands, 'executeCommand').resolves();

		const state = await xousCoreService.ensureXousFolderOpen(root);

		assert.equal(state, 'reopen');
		assert.ok(exec.calledWith('vscode.openFolder'), 'openFolder invoked');
	});

	test('ensureXousFolderOpen: dismissing the modal throws', async () => {
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			undefined,
		);

		await assert.rejects(
			xousCoreService.ensureXousFolderOpen(tmpDir()),
			/xous-core workspace not opened/,
		);
	});

	/* ------------------------------ ensureXousWorkspaceOpen ------------------------------ */

	test('ensureXousWorkspaceOpen accepts a covered root, returns it, and saves the setting', async () => {
		const effectiveRoot = await ensureXousWorkspaceOpen(workspaceRoot());

		assert.equal(
			realPath(String(effectiveRoot)),
			realPath(workspaceRoot()),
			'covered root returned',
		);
		assert.equal(realPath(cfg().get<string>('xousCorePath') || ''), realPath(workspaceRoot()));
	});

	test('ensureXousWorkspaceOpen: "Use current workspace instead" returns the adopted folder, not the configured path', async () => {
		const configured = tmpDir();
		(sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub).resolves(
			'Use current workspace instead',
		);

		const effectiveRoot = await ensureXousWorkspaceOpen(configured);

		// The caller must operate on the adopted workspace, not the declined `configured` path.
		assert.equal(
			realPath(String(effectiveRoot)),
			realPath(workspaceRoot()),
			'adopted workspace root returned',
		);
		assert.notEqual(realPath(String(effectiveRoot)), realPath(configured), 'not the declined path');
		assert.equal(
			realPath(cfg().get<string>('xousCorePath') || ''),
			realPath(workspaceRoot()),
			'setting rewritten to the open workspace',
		);
	});

	test('ensureXousWorkspaceOpen: "Open configured xous-core" reopens and returns undefined', async () => {
		const configured = tmpDir();
		(sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub).resolves(
			'Open configured xous-core',
		);
		const exec = sandbox.stub(vscode.commands, 'executeCommand').resolves();

		const effectiveRoot = await ensureXousWorkspaceOpen(configured);

		assert.equal(effectiveRoot, undefined);
		assert.ok(exec.calledWith('vscode.openFolder'), 'openFolder invoked');
	});

	test('ensureXousWorkspaceOpen: cancelling the mismatch modal returns undefined', async () => {
		const configured = tmpDir();
		(sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub).resolves(
			'Cancel',
		);

		const effectiveRoot = await ensureXousWorkspaceOpen(configured);

		assert.equal(effectiveRoot, undefined);
	});
});
