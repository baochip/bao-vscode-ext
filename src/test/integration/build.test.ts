import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { XOUS_TARGET_TRIPLE } from '@constants';
import * as buildService from '@services/buildService';
import * as logService from '@services/logService';
import * as procService from '@services/procService';
import * as rustCheckService from '@services/rustCheckService';
import * as terminalService from '@services/terminalService';
import * as xousCoreService from '@services/xousCoreService';
import * as xousToolsService from '@services/xousToolsService';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
	activateExtension,
	cleanupTmpDirs,
	makeFakeXousCore,
	resetBaochipConfig,
	tmpDir,
	useSandbox,
} from './helpers';

const cfg = () => vscode.workspace.getConfiguration('baochip');
const setCfg = (key: string, value: unknown) =>
	cfg().update(key, value, vscode.ConfigurationTarget.Workspace);

/** A successful, empty runProcess result. */
const okRun = { code: 0, stdout: '', stderr: '', cancelled: false };

/** A fake output channel capturing appendLine text, castable to vscode.OutputChannel. */
function fakeChannel() {
	const lines: string[] = [];
	const chan = {
		lines,
		appendLine: (l: string) => lines.push(l),
		append: () => {},
		clear: () => {},
		show: () => {},
	};
	return { lines, chan: chan as unknown as vscode.OutputChannel };
}

/** A fake terminal capturing sendText calls, castable to vscode.Terminal. */
function fakeTerminal() {
	const sent: string[] = [];
	const term = {
		sendText: (t: string) => sent.push(t),
		show: () => {},
	};
	return { sent, term: term as unknown as vscode.Terminal };
}

suite('Build service', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	teardown(async () => {
		await resetBaochipConfig();
		cleanupTmpDirs();
	});

	/* ------------------------------ ensureBuildTargetOrPrompt ------------------------------ */

	test('ensureBuildTargetOrPrompt returns the configured target without prompting', async () => {
		await setCfg('buildTarget', 'dabao');
		const warn = sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub;

		const target = await buildService.ensureBuildTargetOrPrompt();

		assert.equal(target, 'dabao');
		assert.ok(warn.notCalled, 'no warning when a target is already set');
	});

	test('ensureBuildTargetOrPrompt: unset target prompts, saves, and returns the pick', async () => {
		(sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub).resolves(
			'Select Target',
		);
		(sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub).resolves({
			label: 'baosec',
		});
		sandbox.stub(vscode.window, 'showInformationMessage');

		const target = await buildService.ensureBuildTargetOrPrompt();

		assert.equal(target, 'baosec', 'returns the freshly picked target (same-run continue)');
		assert.equal(cfg().get<string>('buildTarget'), 'baosec', 'pick was persisted');
	});

	test('ensureBuildTargetOrPrompt: dismissing the warning returns undefined', async () => {
		(sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub).resolves(
			undefined,
		);
		const pick = sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub;

		const target = await buildService.ensureBuildTargetOrPrompt();

		assert.equal(target, undefined);
		assert.ok(pick.notCalled, 'picker never shown');
		assert.equal(cfg().get<string>('buildTarget') || '', '', 'nothing saved');
	});

	/* ------------------------------ ensureBuildPrereqs ------------------------------ */

	function stubXousCorePrereqs(root: string) {
		sandbox.stub(rustCheckService, 'checkRustToolchain').resolves(true);
		sandbox.stub(xousCoreService, 'resolveXousRootOrNotify').resolves(root);
		sandbox.stub(xousCoreService, 'ensureXousFolderOpen').resolves('ready');
	}

	test('ensureBuildPrereqs: xous-core happy path returns root/target/app', async () => {
		const { root } = makeFakeXousCore(tmpDir(), { apps: ['hello'] });
		stubXousCorePrereqs(root);
		await setCfg('buildMode', 'xous-core');
		await setCfg('buildTarget', 'dabao');
		await setCfg('xousAppName', 'hello');

		const pre = await buildService.ensureBuildPrereqs();

		assert.deepEqual(pre, { mode: 'xous-core', root, target: 'dabao', app: 'hello' });
	});

	test('ensureBuildPrereqs: no app configured returns prereqs with app undefined', async () => {
		const { root } = makeFakeXousCore(tmpDir(), { apps: ['hello'] });
		stubXousCorePrereqs(root);
		await setCfg('buildMode', 'xous-core');
		await setCfg('buildTarget', 'dabao');

		const pre = await buildService.ensureBuildPrereqs();

		assert.deepEqual(pre, { mode: 'xous-core', root, target: 'dabao', app: undefined });
	});

	test('ensureBuildPrereqs: one missing app fails with the singular error', async () => {
		const { root } = makeFakeXousCore(tmpDir(), { apps: ['hello'] });
		stubXousCorePrereqs(root);
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		await setCfg('buildMode', 'xous-core');
		await setCfg('buildTarget', 'dabao');
		await setCfg('xousAppName', 'ghost');

		const pre = await buildService.ensureBuildPrereqs();

		assert.equal(pre, undefined);
		assert.ok(errors.calledOnce, 'one error toast');
		const msg = String(errors.firstCall.args[0]);
		assert.ok(msg.includes('"ghost"'), `singular message names the app: ${msg}`);
	});

	test('ensureBuildPrereqs: several missing apps fail with the plural error', async () => {
		const { root } = makeFakeXousCore(tmpDir(), { apps: ['hello'] });
		stubXousCorePrereqs(root);
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		await setCfg('buildMode', 'xous-core');
		await setCfg('buildTarget', 'dabao');
		await setCfg('xousAppName', 'ghost phantom');

		const pre = await buildService.ensureBuildPrereqs();

		assert.equal(pre, undefined);
		const msg = String(errors.firstCall.args[0]);
		assert.ok(msg.includes('ghost, phantom'), `plural message lists all missing apps: ${msg}`);
	});

	test('ensureBuildPrereqs: out-of-tree mode returns the first workspace folder', async () => {
		sandbox.stub(rustCheckService, 'checkRustToolchain').resolves(true);
		sandbox.stub(xousToolsService, 'checkXousAppUf2').resolves(true);
		await setCfg('buildMode', 'out-of-tree');

		const pre = await buildService.ensureBuildPrereqs();

		const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(wsRoot, 'test host has a workspace folder');
		assert.deepEqual(pre, { mode: 'out-of-tree', root: wsRoot, target: '' });
	});

	/* ------------------------------ runBuildAndWait / runOutOfTreeBuildAndWait ------------------------------ */

	test('runBuildAndWait invokes cargo xtask with target and split app words', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		const run = sandbox.stub(procService, 'runProcess').resolves(okRun);

		const code = await buildService.runBuildAndWait('C:\\fake\\root', 'dabao', ' hello  world ');

		assert.equal(code, 0);
		const [cmd, args, opts] = run.firstCall.args;
		assert.equal(cmd, 'cargo');
		assert.deepEqual(args, ['xtask', 'dabao', 'hello', 'world']);
		assert.equal(opts?.cwd, 'C:\\fake\\root');
	});

	test('runBuildAndWait without an app builds the target only', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		const run = sandbox.stub(procService, 'runProcess').resolves(okRun);

		const code = await buildService.runBuildAndWait('C:\\fake\\root', 'dabao');

		assert.equal(code, 0);
		assert.deepEqual(run.firstCall.args[1], ['xtask', 'dabao']);
	});

	test('runBuildAndWait propagates a nonzero exit code and maps spawn errors to 1', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		const run = sandbox.stub(procService, 'runProcess').resolves({ ...okRun, code: 3 });

		assert.equal(await buildService.runBuildAndWait('C:\\fake\\root', 'dabao'), 3);

		run.resolves({ ...okRun, code: null, error: new Error('spawn ENOENT') });
		assert.equal(await buildService.runBuildAndWait('C:\\fake\\root', 'dabao'), 1);
	});

	test('runBuildAndWait reports a cancelled build as failed with a channel line', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		const { lines, chan } = fakeChannel();
		sandbox.stub(logService, 'getChannel').returns(chan);
		sandbox.stub(procService, 'runProcess').resolves({ ...okRun, code: null, cancelled: true });

		const code = await buildService.runBuildAndWait('C:\\fake\\root', 'dabao');

		assert.equal(code, 1);
		assert.ok(
			lines.some((l) => l.includes('Build cancelled by user.')),
			`channel notes the cancellation: ${lines.join(' | ')}`,
		);
	});

	test('runOutOfTreeBuildAndWait passes the fixed features plus configured extras', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		const run = sandbox.stub(procService, 'runProcess').resolves(okRun);
		await setCfg('buildTarget', 'dabao');
		await setCfg('outOfTree.extraFeatures', ['foo', 'not a feature!']);

		const code = await buildService.runOutOfTreeBuildAndWait('C:\\fake\\oot');

		assert.equal(code, 0);
		const [cmd, args, opts] = run.firstCall.args;
		assert.equal(cmd, 'cargo');
		assert.deepEqual(args, [
			'build',
			'--release',
			'--target',
			XOUS_TARGET_TRIPLE,
			'--features',
			'board-dabao',
			'--features',
			'bao1x',
			'--features',
			'utralib/bao1x',
			'--features',
			'foo',
		]);
		assert.equal(opts?.cwd, 'C:\\fake\\oot');
	});

	/* ------------------------------ runOutOfTreeBuildInTerminal ------------------------------ */

	test('runOutOfTreeBuildInTerminal on win32 chains build and UF2 via $LASTEXITCODE', async () => {
		sandbox.stub(process, 'platform').value('win32');
		const root = tmpDir();
		fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname = "myapp"\n', 'utf8');
		const { sent, term } = fakeTerminal();
		const ensure = sandbox.stub(terminalService, 'ensureNamedTerminal').returns(term);

		buildService.runOutOfTreeBuildInTerminal(root);

		assert.equal(ensure.firstCall.args[1], root, 'terminal cwd set via the API, not a typed cd');
		assert.equal(sent.length, 1, `one chained command: ${sent.join(' | ')}`);
		assert.ok(sent[0].includes(`cargo build --release --target ${XOUS_TARGET_TRIPLE}`));
		assert.ok(sent[0].includes('; if ($LASTEXITCODE -eq 0) {'), 'PowerShell 5.x-safe chain');
		assert.ok(sent[0].includes(`xous-app-uf2 --elf target/${XOUS_TARGET_TRIPLE}/release/myapp`));
	});

	test('runOutOfTreeBuildInTerminal on POSIX chains build and UF2 via &&', async () => {
		sandbox.stub(process, 'platform').value('linux');
		const root = tmpDir();
		fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname = "myapp"\n', 'utf8');
		const { sent, term } = fakeTerminal();
		sandbox.stub(terminalService, 'ensureNamedTerminal').returns(term);

		buildService.runOutOfTreeBuildInTerminal(root);

		assert.equal(sent.length, 1);
		assert.ok(sent[0].includes(' && xous-app-uf2 --elf '), `POSIX && chain: ${sent[0]}`);
	});

	test('runOutOfTreeBuildInTerminal without a readable package name sends the build only', async () => {
		const root = tmpDir(); // no Cargo.toml at all
		const { sent, term } = fakeTerminal();
		sandbox.stub(terminalService, 'ensureNamedTerminal').returns(term);

		buildService.runOutOfTreeBuildInTerminal(root);

		assert.equal(sent.length, 1);
		assert.ok(sent[0].includes('cargo build --release'), 'build command still sent');
		assert.ok(!sent[0].includes('xous-app-uf2'), 'no UF2 chain without a package name');
	});

	test('runOutOfTreeBuildInTerminal skips the UF2 chain for a malformed crate name', async () => {
		const root = tmpDir();
		fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname = "my;app $(x)"\n', 'utf8');
		const { sent, term } = fakeTerminal();
		sandbox.stub(terminalService, 'ensureNamedTerminal').returns(term);

		buildService.runOutOfTreeBuildInTerminal(root);

		assert.equal(sent.length, 1);
		assert.ok(sent[0].includes('cargo build --release'), 'build command still sent');
		assert.ok(!sent[0].includes('my;app'), 'malformed name never reaches the terminal');
		assert.ok(!sent[0].includes('xous-app-uf2'), 'no UF2 chain');
	});

	/* ------------------------------ runBuildInTerminal ------------------------------ */

	test('runBuildInTerminal sends cargo xtask with the target and app words', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		const { sent, term } = fakeTerminal();
		sandbox.stub(terminalService, 'ensureNamedTerminal').returns(term);

		buildService.runBuildInTerminal('C:\\fake\\root', 'dabao', 'hello world');

		assert.deepEqual(sent, ['cargo xtask dabao hello world']);
	});

	test('runBuildInTerminal rejects a build target outside the known list', async () => {
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		const ensure = sandbox.stub(terminalService, 'ensureNamedTerminal');

		buildService.runBuildInTerminal('C:\\fake\\root', 'dabao; rm -rf ~', 'hello');

		assert.ok(ensure.notCalled, 'no terminal opened');
		assert.ok(String(errors.firstCall.args[0]).includes('Invalid build target'));
	});

	test('runBuildInTerminal rejects an app word with shell metacharacters', async () => {
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		const ensure = sandbox.stub(terminalService, 'ensureNamedTerminal');

		buildService.runBuildInTerminal('C:\\fake\\root', 'dabao', 'hello $(evil)');

		assert.ok(ensure.notCalled, 'no terminal opened');
		assert.ok(String(errors.firstCall.args[0]).includes('Invalid app name'));
	});
});
