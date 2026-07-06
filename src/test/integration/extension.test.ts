import * as assert from 'node:assert';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import { migrateWelcomeSettingToGlobal, runStartupStep } from '../../extension';
import { activateExtension, useSandbox } from './helpers';

suite('Extension smoke', () => {
	let manifest: {
		contributes: {
			commands: { command: string }[];
			views: Record<string, { id: string }[]>;
			configuration: { properties?: Record<string, unknown> }[];
		};
	};
	let commands: Set<string>;

	suiteSetup(async () => {
		const ext = await activateExtension();
		manifest = ext.packageJSON as typeof manifest;
		commands = new Set(await vscode.commands.getCommands(true));
	});

	test('registers every contributed command', () => {
		for (const { command } of manifest.contributes.commands) {
			assert.ok(commands.has(command), `command not registered: ${command}`);
		}
	});

	test('contributes every declared view', () => {
		const viewIds = Object.values(manifest.contributes.views)
			.flat()
			.map((v) => v.id);
		assert.ok(viewIds.length > 0, 'expected at least one contributed view');
		for (const id of viewIds) {
			// VS Code auto-registers a `<viewId>.focus` command for each contributed view
			assert.ok(commands.has(`${id}.focus`), `view not contributed: ${id}`);
		}
	});

	test('registers configuration for every contributed setting', () => {
		const config = vscode.workspace.getConfiguration();
		const keys = manifest.contributes.configuration.flatMap((s) => Object.keys(s.properties ?? {}));
		assert.ok(keys.length > 0, 'expected contributed settings');
		for (const key of keys) {
			assert.ok(config.has(key), `setting not registered: ${key}`);
		}
	});

	test('runStartupStep swallows a failing step so activation is not aborted', async () => {
		let attempted = false;
		await assert.doesNotReject(
			runStartupStep('boom', async () => {
				attempted = true;
				throw new Error('settings.json is dirty'); // e.g. cfg.update rejecting
			}),
		);
		assert.ok(attempted, 'the step was attempted before the failure was swallowed');
	});

	test('runStartupStep runs a passing step to completion', async () => {
		let value = 0;
		await runStartupStep('ok', async () => {
			value = 42;
		});
		assert.equal(value, 42);
	});
});

suite('migrateWelcomeSettingToGlobal', () => {
	const sandbox = useSandbox();
	const KEY = 'baochip.showWelcomeOnStartup';

	test('promotes a per-folder legacy value to Global and clears only that folder (multi-root)', async () => {
		const folderA = { uri: vscode.Uri.parse('file:///a') } as vscode.WorkspaceFolder;
		const folderB = { uri: vscode.Uri.parse('file:///b') } as vscode.WorkspaceFolder;
		sandbox.stub(vscode.workspace, 'workspaceFolders').get(() => [folderA, folderB]);

		const topUpdate = sandbox.spy();
		const topCfg = {
			inspect: () => ({ workspaceValue: undefined, globalValue: undefined }),
			update: topUpdate,
		};
		// Only folderA carries a legacy per-folder value; the top-level inspect never sees it.
		const folderAUpdate = sandbox.spy();
		const folderBUpdate = sandbox.spy();
		const folderCfgA = { inspect: () => ({ workspaceFolderValue: false }), update: folderAUpdate };
		const folderCfgB = {
			inspect: () => ({ workspaceFolderValue: undefined }),
			update: folderBUpdate,
		};

		(sandbox.stub(vscode.workspace, 'getConfiguration') as unknown as sinon.SinonStub).callsFake(
			(_section?: string, resource?: vscode.Uri) => {
				if (!resource) return topCfg;
				return resource === folderA.uri ? folderCfgA : folderCfgB;
			},
		);

		await migrateWelcomeSettingToGlobal();

		assert.ok(
			topUpdate.calledOnceWithExactly(KEY, false, vscode.ConfigurationTarget.Global),
			'the folder value is promoted to Global',
		);
		assert.ok(
			folderAUpdate.calledOnceWithExactly(
				KEY,
				undefined,
				vscode.ConfigurationTarget.WorkspaceFolder,
			),
			'the folder holding the legacy value is cleared',
		);
		assert.ok(folderBUpdate.notCalled, 'a folder without a value is left untouched');
	});
});
