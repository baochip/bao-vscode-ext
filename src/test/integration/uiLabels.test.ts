import * as assert from 'node:assert';
import { buildCommandLabel, monitorTooltip } from '@views/uiLabels';
import * as vscode from 'vscode';
import { activateExtension, resetBaochipConfig } from './helpers';

const setCfg = (key: string, value: unknown) =>
	vscode.workspace
		.getConfiguration('baochip')
		.update(key, value, vscode.ConfigurationTarget.Workspace);

suite('Shared UI labels (status bar and tree agree)', () => {
	suiteSetup(async () => {
		await activateExtension();
	});

	teardown(async () => {
		await resetBaochipConfig();
	});

	test('buildCommandLabel names the build tool for each mode', () => {
		assert.ok(buildCommandLabel('xous-core').includes('xtask'), 'xous-core builds via cargo xtask');
		assert.ok(
			buildCommandLabel('out-of-tree').includes('cargo build'),
			'out-of-tree builds via cargo build',
		);
	});

	test('monitorTooltip names the mode, port, and baud when the port is set', async () => {
		await setCfg('monitorDefaultPort', 'run');
		await setCfg('serialPortRun', 'COM7');

		const tip = monitorTooltip();

		assert.ok(tip.includes('Run'), `names the run mode: ${tip}`);
		assert.ok(tip.includes('COM7') && tip.includes('1000000'), `port and baud: ${tip}`);
	});

	test('monitorTooltip reports an unset port with the unified wording', async () => {
		await setCfg('monitorDefaultPort', 'bootloader'); // bootloader port left unset

		const tip = monitorTooltip();

		assert.ok(tip.includes('bootloader mode port not set'), `unset tooltip: ${tip}`);
	});
});
