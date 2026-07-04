import * as assert from 'node:assert';
import { sendBoot } from '@services/bootService';
import * as procService from '@services/procService';
import * as uvService from '@services/uvService';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import { activateExtension, resetBaochipConfig, useSandbox } from './helpers';

// Canary suite for the test harness itself: proves the fixture workspace accepts config
// writes, that stubbing the shared vscode API object reaches the running extension, and
// that stubbing a module's exports intercepts cross-module calls inside the extension.
suite('Harness canary', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	teardown(async () => {
		await resetBaochipConfig();
	});

	test('config round-trips in the fixture workspace', async () => {
		const cfg = () => vscode.workspace.getConfiguration('baochip');
		await cfg().update('buildTarget', 'dabao', vscode.ConfigurationTarget.Workspace);
		assert.equal(cfg().get<string>('buildTarget'), 'dabao');

		await resetBaochipConfig();
		assert.equal(cfg().get<string>('buildTarget') || '', '');
	});

	test('stubbed QuickPick drives the setBuildMode command end to end', async () => {
		(sandbox.stub(vscode.window, 'showQuickPick') as sinon.SinonStub).resolves({
			label: 'out-of-tree',
			setting: 'out-of-tree',
		});

		await vscode.commands.executeCommand('baochip.setBuildMode');

		assert.equal(
			vscode.workspace.getConfiguration('baochip').get<string>('buildMode'),
			'out-of-tree',
		);
	});

	test('module-export stubs intercept cross-module calls (sendBoot)', async () => {
		await vscode.workspace
			.getConfiguration('baochip')
			.update('serialPortBootloader', 'COM99', vscode.ConfigurationTarget.Workspace);

		sandbox.stub(uvService, 'getBaoRunner').resolves({ cmd: 'uv', args: ['run', 'python'] });
		const runStub = sandbox
			.stub(procService, 'runProcess')
			.resolves({ code: 0, stdout: '', stderr: '', cancelled: false });

		const ok = await sendBoot();

		assert.equal(ok, true);
		assert.ok(runStub.calledOnce, 'runProcess should be called exactly once');
		const [cmd, args] = runStub.firstCall.args;
		assert.equal(cmd, 'uv');
		assert.ok(args.includes('boot'), `args should include "boot": ${args.join(' ')}`);
		assert.ok(args.includes('COM99'), `args should include the port: ${args.join(' ')}`);
	});
});
