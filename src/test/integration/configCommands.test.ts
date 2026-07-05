import * as assert from 'node:assert';
import { Commands } from '@commands/commandIds';
import * as buildService from '@services/buildService';
import {
	getDefaultBaud,
	getExtraFeatures,
	getKernelMode,
	getMonitorDefaultPort,
	getMonitorFlags,
} from '@services/configService';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import { activateExtension, resetBaochipConfig, useSandbox } from './helpers';

const cfg = () => vscode.workspace.getConfiguration('baochip');
const setCfg = (key: string, value: unknown) =>
	cfg().update(key, value, vscode.ConfigurationTarget.Workspace);
const workspaceValue = (key: string) => cfg().inspect(key)?.workspaceValue;

suite('Config and selection commands', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	teardown(async () => {
		await resetBaochipConfig();
	});

	/* ------------------------------ setMonitorBaud ------------------------------ */

	test('setMonitorBaud saves the entered baud rate', async () => {
		sandbox.stub(vscode.window, 'showInputBox').resolves('115200');

		await vscode.commands.executeCommand(Commands.setMonitorBaud);

		assert.equal(cfg().get<number>('monitor.defaultBaud'), 115200);
	});

	test('setMonitorBaud saves nothing when the input box is cancelled', async () => {
		sandbox.stub(vscode.window, 'showInputBox').resolves(undefined);

		await vscode.commands.executeCommand(Commands.setMonitorBaud);

		assert.equal(workspaceValue('monitor.defaultBaud'), undefined, 'no workspace value written');
	});

	test('setMonitorBaud validation rejects non-positive and non-integer input', async () => {
		const input = sandbox.stub(vscode.window, 'showInputBox').resolves(undefined);

		await vscode.commands.executeCommand(Commands.setMonitorBaud);

		const validate = input.firstCall.args[0]?.validateInput;
		assert.ok(validate, 'input box has a validator');
		for (const bad of ['0', '-5', 'abc', '1.5', '']) {
			assert.notEqual(await validate(bad), null, `"${bad}" should be rejected`);
		}
		for (const good of ['9600', '1000000']) {
			assert.equal(await validate(good), null, `"${good}" should be accepted`);
		}
	});

	/* ------------------------------ setMonitorDefaultPort ------------------------------ */

	test('setMonitorDefaultPort saves the picked mode and confirms with a toast', async () => {
		(sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub).resolves({
			label: 'Bootloader (drive mode)',
			value: 'bootloader',
		});
		const info = sandbox.stub(
			vscode.window,
			'showInformationMessage',
		) as unknown as sinon.SinonStub;

		await vscode.commands.executeCommand(Commands.setMonitorDefaultPort);

		assert.equal(cfg().get<string>('monitorDefaultPort'), 'bootloader');
		assert.ok(
			info.getCalls().some((c) => String(c.args[0]).includes('Bootloader')),
			'confirmation toast shows the localized label, not the raw enum value',
		);
	});

	test('setMonitorDefaultPort saves nothing when the picker is cancelled', async () => {
		(sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub).resolves(
			undefined,
		);

		await vscode.commands.executeCommand(Commands.setMonitorDefaultPort);

		assert.equal(workspaceValue('monitorDefaultPort'), undefined);
	});

	/* ------------------------------ setBuildMode ------------------------------ */

	test('setBuildMode saves each picked mode', async () => {
		const pick = sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub;

		for (const mode of ['xous-core', 'out-of-tree', 'auto'] as const) {
			pick.resolves({ label: mode, setting: mode });
			await vscode.commands.executeCommand(Commands.setBuildMode);
			assert.equal(cfg().get<string>('buildMode'), mode, `buildMode saved as ${mode}`);
		}
	});

	test('setBuildMode marks the current setting with a check and shows the resolved mode', async () => {
		await setCfg('buildMode', 'out-of-tree');
		const pick = sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub;
		pick.resolves(undefined);

		await vscode.commands.executeCommand(Commands.setBuildMode);

		const items = pick.firstCall.args[0] as { label: string; setting: string }[];
		const current = items.find((i) => i.setting === 'out-of-tree');
		const others = items.filter((i) => i.setting !== 'out-of-tree');
		assert.ok(current?.label.startsWith('$(check)'), 'current mode carries the check icon');
		assert.ok(
			others.every((i) => !i.label.includes('$(check)')),
			'non-current modes have no check icon',
		);
		const auto = items.find((i) => i.setting === 'auto') as { description?: string };
		assert.ok(
			auto.description?.includes('out-of-tree'),
			`auto option shows the resolved mode: ${auto.description}`,
		);
	});

	test('setBuildMode saves nothing when the picker is cancelled', async () => {
		(sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub).resolves(
			undefined,
		);

		await vscode.commands.executeCommand(Commands.setBuildMode);

		assert.equal(workspaceValue('buildMode'), undefined);
	});

	/* ------------------------------ selectBuildTarget / promptAndSaveBuildTarget ------------------------------ */

	test('selectBuildTarget command saves the picked target', async () => {
		(sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub).resolves({
			label: 'baosec',
		});
		sandbox.stub(vscode.window, 'showInformationMessage');

		await vscode.commands.executeCommand(Commands.selectBuildTarget);

		assert.equal(cfg().get<string>('buildTarget'), 'baosec');
	});

	test('promptAndSaveBuildTarget marks the current target and offers all targets', async () => {
		await setCfg('buildTarget', 'dabao');
		const pick = sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub;
		pick.resolves(undefined);

		const result = await buildService.promptAndSaveBuildTarget();

		assert.equal(result, undefined, 'cancel returns undefined');
		assert.equal(cfg().get<string>('buildTarget'), 'dabao', 'cancel leaves the setting alone');
		const items = pick.firstCall.args[0] as { label: string; description?: string }[];
		assert.deepEqual(
			items.map((i) => i.label),
			['dabao', 'baosec'],
			'all build targets offered',
		);
		assert.equal(items[0].description, 'current', 'configured target marked current');
		assert.equal(items[1].description, undefined);
	});

	/* ------------------------------ configService hardening getters ------------------------------ */

	test('getDefaultBaud falls back to 1000000 for zero, negative, and unset values', async () => {
		assert.equal(getDefaultBaud(), 1000000, 'default when unset');

		await setCfg('monitor.defaultBaud', 0);
		assert.equal(getDefaultBaud(), 1000000, 'zero rejected');

		await setCfg('monitor.defaultBaud', -9600);
		assert.equal(getDefaultBaud(), 1000000, 'negative rejected');

		await setCfg('monitor.defaultBaud', 115200);
		assert.equal(getDefaultBaud(), 115200, 'valid value passes through');
	});

	test('getKernelMode returns ask for unknown values and passes valid modes', async () => {
		assert.equal(getKernelMode(), 'ask', 'default when unset');

		await setCfg('outOfTree.kernelMode', 'garbage');
		assert.equal(getKernelMode(), 'ask', 'unknown value coerced to ask');

		await setCfg('outOfTree.kernelMode', 'ci-sync');
		assert.equal(getKernelMode(), 'ci-sync');

		await setCfg('outOfTree.kernelMode', 'manual');
		assert.equal(getKernelMode(), 'manual');
	});

	test('getMonitorDefaultPort coerces unknown values to run', async () => {
		assert.equal(getMonitorDefaultPort(), 'run', 'default when unset');

		await setCfg('monitorDefaultPort', 'garbage');
		assert.equal(getMonitorDefaultPort(), 'run', 'unknown value coerced to run');

		await setCfg('monitorDefaultPort', 'bootloader');
		assert.equal(getMonitorDefaultPort(), 'bootloader');
	});

	test('getExtraFeatures filters out values that are not valid cargo feature names', async () => {
		await setCfg('outOfTree.extraFeatures', [
			'ok-feature',
			'utralib/bao1x',
			'bad name;rm -rf',
			'--flag',
			'',
		]);

		assert.deepEqual(getExtraFeatures(), ['ok-feature', 'utralib/bao1x']);
	});

	test('getMonitorFlags defaults to crlf+raw on, echo off, and follows settings', async () => {
		assert.deepEqual(getMonitorFlags(), { crlf: true, raw: true, echo: false });

		await setCfg('monitor.crlf', false);
		await setCfg('monitor.echo', true);
		assert.deepEqual(getMonitorFlags(), { crlf: false, raw: true, echo: true });
	});
});
