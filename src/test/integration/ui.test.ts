import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { withCommand } from '@commands/withCommand';
import { errorToast, getBaochipChannel } from '@services/logService';
import { getGlobalVenvRoot, resetUvSetup } from '@services/uvService';
import { BaoTreeProvider } from '@tree/baoTree';
import { DocsTreeProvider } from '@tree/docsTree';
import { WelcomePanel } from '@webviews/welcome/welcomePanel';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import { activateExtension, resetBaochipConfig, useSandbox } from './helpers';

const setCfg = (key: string, value: unknown) =>
	vscode.workspace
		.getConfiguration('baochip')
		.update(key, value, vscode.ConfigurationTarget.Workspace);

function labels(items: vscode.TreeItem[]): string[] {
	return items.map((i) => String(i.label));
}

suite('Tree views, welcome panel, and error funnel', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	teardown(async () => {
		await resetBaochipConfig();
	});

	/* ------------------------------ BaoTreeProvider ------------------------------ */

	test('bao tree offers Select app only in xous-core mode', async () => {
		const tree = new BaoTreeProvider();

		await setCfg('buildMode', 'xous-core');
		let items = labels(await tree.getChildren());
		assert.ok(items.includes('Select app'), `xous-core tree has Select app: ${items.join(', ')}`);
		assert.ok(items.includes('Build (cargo xtask)'), 'xous-core build label');

		await setCfg('buildMode', 'out-of-tree');
		items = labels(await tree.getChildren());
		assert.ok(!items.includes('Select app'), 'out-of-tree tree hides Select app');
		assert.ok(items.includes('Build (cargo build)'), 'out-of-tree build label');
	});

	test('BaoTreeProvider is disposable so its change emitter is released on deactivate', () => {
		const tree = new BaoTreeProvider();
		assert.doesNotThrow(() => {
			tree.dispose();
			tree.dispose(); // idempotent
		});
	});

	test('bao tree monitor child names the default monitor port', async () => {
		const tree = new BaoTreeProvider();
		const monitorNode = (await tree.getChildren()).find((i) => String(i.label) === 'Monitor');
		assert.ok(monitorNode, 'monitor node present');

		let children = labels(await tree.getChildren(monitorNode));
		assert.deepEqual(children, ['Default monitor: Run'], 'run is the default');

		await setCfg('monitorDefaultPort', 'bootloader');
		children = labels(await tree.getChildren(monitorNode));
		assert.deepEqual(children, ['Default monitor: Bootloader']);
	});

	test('bao tree monitor tooltip reflects the configured port', async () => {
		const tree = new BaoTreeProvider();
		const monitorNode = (await tree.getChildren()).find((i) => String(i.label) === 'Monitor');
		assert.ok(monitorNode, 'monitor node present');

		let tooltip = String(tree.getTreeItem(monitorNode).tooltip);
		assert.ok(tooltip.includes('run mode port not set'), `unset tooltip: ${tooltip}`);

		await setCfg('serialPortRun', 'COM7');
		tooltip = String(tree.getTreeItem(monitorNode).tooltip);
		assert.ok(tooltip.includes('COM7') && tooltip.includes('1000000'), `set tooltip: ${tooltip}`);
	});

	test('every bao tree item is wired to a command', async () => {
		const tree = new BaoTreeProvider();
		for (const item of await tree.getChildren()) {
			assert.ok(item.command?.command, `"${String(item.label)}" has a command`);
			assert.ok(
				item.command.command.startsWith('baochip.'),
				`"${String(item.label)}" runs a baochip command`,
			);
		}
	});

	/* ------------------------------ DocsTreeProvider ------------------------------ */

	test('docs tree opens each documentation link in the browser', async () => {
		const docs = new DocsTreeProvider();
		const items = await docs.getChildren();

		assert.equal(items.length, 4, 'four documentation links');
		for (const item of items) {
			assert.equal(item.command?.command, 'vscode.open');
			const target = item.command?.arguments?.[0] as vscode.Uri;
			assert.ok(String(target).startsWith('https://'), `"${String(item.label)}" opens a URL`);
			assert.equal(String(item.tooltip), String(target), 'tooltip shows the URL');
		}
	});

	/* ------------------------------ withCommand error funnel ------------------------------ */

	test('withCommand funnels a thrown error into one toast', async () => {
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		const disposable = withCommand('baochip.test.throwing', () => {
			throw new Error('kaboom');
		});
		try {
			await vscode.commands.executeCommand('baochip.test.throwing');
		} finally {
			disposable.dispose();
		}

		assert.equal(errors.callCount, 1, 'exactly one error toast');
		const msg = String(errors.firstCall.args[0]);
		assert.ok(msg.includes('command failed') && msg.includes('kaboom'), msg);
		assert.ok(errors.firstCall.args.includes('Show Output'), 'the funnel toast offers Show Output');
	});

	/* ------------------------------ error toast actions ------------------------------ */

	test('errorToast offers Show Output, and clicking it reveals the Baochip channel', async () => {
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		errors.resolves('Show Output');
		const show = sandbox.stub(getBaochipChannel(), 'show') as unknown as sinon.SinonStub;

		errorToast('kaboom');
		await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget click handler run

		assert.equal(errors.callCount, 1, 'exactly one error toast');
		assert.deepEqual(errors.firstCall.args.slice(1), ['Show Output'], 'one Show Output button');
		assert.ok(show.calledOnceWithExactly(true), 'channel revealed, keyboard focus preserved');
	});

	test('errorToast does not open the output channel when the toast is dismissed', async () => {
		(sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub).resolves(
			undefined,
		);
		const show = sandbox.stub(getBaochipChannel(), 'show');

		errorToast('kaboom');
		await new Promise((r) => setTimeout(r, 0));

		assert.equal(show.callCount, 0, 'the channel opens only via the button');
	});

	test('errorToast runs a caller-supplied action, listed before Show Output', async () => {
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		errors.resolves('Do Thing');
		let ran = false;

		errorToast('kaboom', [{ label: 'Do Thing', run: () => (ran = true) }]);
		await new Promise((r) => setTimeout(r, 0));

		assert.deepEqual(errors.firstCall.args.slice(1), ['Do Thing', 'Show Output']);
		assert.ok(ran, 'the clicked action ran');
	});

	/* ------------------------------ WelcomePanel ------------------------------ */

	test('opening the welcome command twice reuses one panel; dispose clears it', async () => {
		await vscode.commands.executeCommand('baochip.openWelcome');
		const first = WelcomePanel.current;
		assert.ok(first, 'panel created');

		await vscode.commands.executeCommand('baochip.openWelcome');
		assert.equal(WelcomePanel.current, first, 'second open reveals the same panel');

		first.dispose();
		assert.equal(WelcomePanel.current, undefined, 'dispose clears the singleton');
	});

	/* ------------------------------ resetUvSetup ------------------------------ */

	test('resetUvSetup offers to delete the cached venv and removes it on confirm', async () => {
		const venvDir = path.join(getGlobalVenvRoot(), '.venv');
		fs.mkdirSync(venvDir, { recursive: true });
		fs.writeFileSync(path.join(venvDir, 'pyvenv.cfg'), 'home = fake', 'utf8');
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'Delete .venv',
		);

		try {
			await resetUvSetup();
			assert.ok(!fs.existsSync(venvDir), 'cached venv deleted on confirm');
		} finally {
			fs.rmSync(venvDir, { recursive: true, force: true });
		}
	});
});
