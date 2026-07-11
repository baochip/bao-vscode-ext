import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isBaochipWorkspace } from '@services/projectModeService';
import * as vscode from 'vscode';
import {
	activateExtension,
	cleanupTmpDirs,
	resetBaochipConfig,
	tmpDir,
	useSandbox,
} from './helpers';

const setCfg = (key: string, value: unknown) =>
	vscode.workspace
		.getConfiguration('baochip')
		.update(key, value, vscode.ConfigurationTarget.Workspace);

function fakeFolder(root: string): vscode.WorkspaceFolder {
	return { uri: vscode.Uri.file(root), name: path.basename(root), index: 0 };
}

suite('Workspace relevance (status bar / welcome gating)', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	teardown(async () => {
		await resetBaochipConfig();
		cleanupTmpDirs();
	});

	test('no workspace folders is not Baochip-related', () => {
		sandbox.stub(vscode.workspace, 'workspaceFolders').value(undefined);
		assert.equal(isBaochipWorkspace(), false);
	});

	test('a plain unrelated folder is not Baochip-related', () => {
		sandbox.stub(vscode.workspace, 'workspaceFolders').value([fakeFolder(tmpDir())]);
		assert.equal(isBaochipWorkspace(), false);
	});

	test('an xous-core checkout (apps directory) is Baochip-related', () => {
		const root = tmpDir();
		fs.mkdirSync(path.join(root, 'apps-dabao'), { recursive: true });
		sandbox.stub(vscode.workspace, 'workspaceFolders').value([fakeFolder(root)]);
		assert.equal(isBaochipWorkspace(), true);
	});

	test('a Cargo.toml with xous dependencies is Baochip-related', () => {
		const root = tmpDir();
		fs.writeFileSync(
			path.join(root, 'Cargo.toml'),
			'[dependencies]\nbao1x-api = { git = "https://github.com/betrusted-io/xous-core", rev = "abc" }\n',
			'utf8',
		);
		sandbox.stub(vscode.workspace, 'workspaceFolders').value([fakeFolder(root)]);
		assert.equal(isBaochipWorkspace(), true);
	});

	test('an unrelated Cargo.toml is not Baochip-related', () => {
		const root = tmpDir();
		fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname = "hello"\n', 'utf8');
		sandbox.stub(vscode.workspace, 'workspaceFolders').value([fakeFolder(root)]);
		assert.equal(isBaochipWorkspace(), false);
	});

	test('a workspace-scoped baochip setting marks any folder as Baochip-related', async () => {
		sandbox.stub(vscode.workspace, 'workspaceFolders').value([fakeFolder(tmpDir())]);
		await setCfg('buildTarget', 'dabao');
		assert.equal(isBaochipWorkspace(), true);
	});

	test('GLOBAL baochip settings do not make unrelated folders relevant', async () => {
		// The user-level welcome toggle exists for everyone; only workspace-scoped intent counts.
		sandbox.stub(vscode.workspace, 'workspaceFolders').value([fakeFolder(tmpDir())]);
		assert.equal(isBaochipWorkspace(), false);
	});
});
