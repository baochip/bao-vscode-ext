import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { runStartupStep } from '../../extension';
import { activateExtension } from './helpers';

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
