import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { XOUS_TARGET_TRIPLE } from '@constants';
import * as buildService from '@services/buildService';
import * as buildTargetService from '@services/buildTargetService';
import * as logService from '@services/logService';
import * as procService from '@services/procService';
import * as projectModeService from '@services/projectModeService';
import * as rustCheckService from '@services/rustCheckService';
import * as terminalService from '@services/terminalService';
import * as xousCoreService from '@services/xousCoreService';
import * as xousToolsService from '@services/xousToolsService';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
	activateExtension,
	cleanupTmpDirs,
	fakeChannel,
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

/** A fake terminal capturing commands, castable to vscode.Terminal. Carries shell integration
 * so runInTerminal resolves at once rather than waiting out its timeout. */
function fakeTerminal() {
	const sent: string[] = [];
	const term = {
		sendText: (t: string) => sent.push(t),
		shellIntegration: { executeCommand: (t: string) => sent.push(t) },
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

	/* ------------------------------ ensureBuildTarget ------------------------------ */

	test('ensureBuildTarget returns the configured target without prompting', async () => {
		await setCfg('buildTarget', 'baosec');
		const pick = sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub;

		assert.equal(await buildTargetService.ensureBuildTarget(), 'baosec');
		assert.ok(pick.notCalled, 'an answered question is not asked again');
	});

	test('ensureBuildTarget: an unset target asks once, saves, and returns the pick', async () => {
		(sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub).resolves({
			label: 'baosec',
		});
		sandbox.stub(vscode.window, 'showInformationMessage');

		assert.equal(await buildTargetService.ensureBuildTarget(), 'baosec', 'the pick is returned');
		assert.equal(cfg().get<string>('buildTarget'), 'baosec', 'and persisted, so it asks only once');
	});

	test('ensureBuildTarget: nothing is assumed when the picker is dismissed', async () => {
		(sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub).resolves(
			undefined,
		);

		assert.equal(await buildTargetService.ensureBuildTarget(), undefined);
		assert.equal(
			cfg().get<string>('buildTarget') || '',
			'',
			'no target is written behind our back',
		);
	});

	test('ensureBuildTarget: a hand-edited target outside the known list is rejected', async () => {
		await setCfg('buildTarget', 'dabao; rm -rf /');
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		assert.equal(await buildTargetService.ensureBuildTarget(), undefined);
		assert.ok(
			String(errors.firstCall.args[0]).includes('Invalid hardware target'),
			'the bad value is reported',
		);
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

	test('ensureBuildPrereqs: rejects a buildTarget not in BUILD_TARGETS', async () => {
		const { root } = makeFakeXousCore(tmpDir(), { apps: ['hello'] });
		stubXousCorePrereqs(root);
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		await setCfg('buildMode', 'xous-core');
		await setCfg('buildTarget', '--config=evil');

		const pre = await buildService.ensureBuildPrereqs();

		assert.equal(pre, undefined, 'prereqs aborted on an unrecognized target');
		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('Invalid hardware target')),
			'invalid-target error shown',
		);
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
		assert.ok(msg.includes('ghost'), `the message names the app: ${msg}`);
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

	test('ensureBuildPrereqs: out-of-tree mode returns the folder and the selected crates', async () => {
		await setCfg('buildTarget', 'dabao');
		sandbox.stub(rustCheckService, 'checkRustToolchain').resolves(true);
		sandbox.stub(xousToolsService, 'checkXousAppUf2').resolves(true);
		await setCfg('buildMode', 'out-of-tree');
		await setCfg('xousAppName', 'alpha zeta');

		const pre = await buildService.ensureBuildPrereqs();

		const wsRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		assert.ok(wsRoot, 'test host has a workspace folder');
		assert.deepEqual(pre, { mode: 'out-of-tree', root: wsRoot, crates: ['alpha', 'zeta'] });
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

	test('runBuildAndWait reports a cancelled build as null with a channel line, not a failure', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		const { lines, chan } = fakeChannel();
		sandbox.stub(logService, 'getBaochipChannel').returns(chan);
		sandbox.stub(procService, 'runProcess').resolves({ ...okRun, code: null, cancelled: true });

		const code = await buildService.runBuildAndWait('C:\\fake\\root', 'dabao');

		assert.equal(code, null, 'cancellation is distinguishable from failure');
		assert.ok(
			lines.some((l) => l.includes('Build cancelled by user.')),
			`channel notes the cancellation: ${lines.join(' | ')}`,
		);
	});

	test('runBuildAndWait surfaces the spawn error message in the channel', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		const { lines, chan } = fakeChannel();
		sandbox.stub(logService, 'getBaochipChannel').returns(chan);
		sandbox
			.stub(procService, 'runProcess')
			.resolves({ ...okRun, code: null, error: new Error('spawn cargo ENOENT') });

		const code = await buildService.runBuildAndWait('C:\\fake\\root', 'dabao');

		assert.equal(code, 1);
		assert.ok(
			lines.some((l) => l.includes('spawn cargo ENOENT')),
			`channel carries the real spawn failure: ${lines.join(' | ')}`,
		);
	});

	test('runOutOfTreeBuildAndWait passes the fixed features plus configured extras', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		const run = sandbox.stub(procService, 'runProcess').resolves(okRun);
		await setCfg('buildTarget', 'dabao');
		await setCfg('outOfTree.extraFeatures', ['foo', 'not a feature!']);

		const code = await buildService.runOutOfTreeBuildAndWait('C:\\fake\\oot', ['hello']);

		assert.equal(code, 0);
		const [cmd, args, opts] = run.firstCall.args;
		assert.equal(cmd, 'cargo');
		assert.deepEqual(args, [
			'build',
			'--release',
			'--target',
			XOUS_TARGET_TRIPLE,
			'-p',
			'hello',
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
		await setCfg('buildTarget', 'dabao');
		sandbox.stub(process, 'platform').value('win32');
		const root = tmpDir();
		fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname = "myapp"\n', 'utf8');
		const { sent, term } = fakeTerminal();
		const ensure = sandbox.stub(terminalService, 'ensureNamedTerminal').returns(term);

		await buildService.runOutOfTreeBuildInTerminal(root, ['hello']);

		assert.equal(ensure.firstCall.args[1], root, 'terminal cwd set via the API, not a typed cd');
		assert.equal(sent.length, 1, `one chained command: ${sent.join(' | ')}`);
		assert.ok(sent[0].includes(`cargo build --release --target ${XOUS_TARGET_TRIPLE}`));
		assert.ok(sent[0].includes('; if ($LASTEXITCODE -eq 0) {'), 'PowerShell 5.x-safe chain');
		assert.ok(sent[0].includes(`xous-app-uf2 --elf target/${XOUS_TARGET_TRIPLE}/release/hello`));
	});

	test('runOutOfTreeBuildInTerminal on POSIX chains build and UF2 via &&', async () => {
		await setCfg('buildTarget', 'dabao');
		sandbox.stub(process, 'platform').value('linux');
		const root = tmpDir();
		fs.writeFileSync(path.join(root, 'Cargo.toml'), '[package]\nname = "myapp"\n', 'utf8');
		const { sent, term } = fakeTerminal();
		sandbox.stub(terminalService, 'ensureNamedTerminal').returns(term);

		await buildService.runOutOfTreeBuildInTerminal(root, ['hello']);

		assert.equal(sent.length, 1);
		assert.ok(sent[0].includes(' && xous-app-uf2 --elf '), `POSIX && chain: ${sent[0]}`);
	});

	test('runOutOfTreeBuildInTerminal passes one --elf per selected crate', async () => {
		await setCfg('buildTarget', 'dabao');
		const root = tmpDir();
		const { sent, term } = fakeTerminal();
		sandbox.stub(terminalService, 'ensureNamedTerminal').returns(term);

		await buildService.runOutOfTreeBuildInTerminal(root, ['alpha', 'zeta']);

		assert.equal(sent.length, 1);
		assert.ok(sent[0].includes('-p alpha'), `alpha selected: ${sent[0]}`);
		assert.ok(sent[0].includes('-p zeta'), `zeta selected: ${sent[0]}`);
		assert.ok(sent[0].includes(`--elf target/${XOUS_TARGET_TRIPLE}/release/alpha`));
		assert.ok(sent[0].includes(`--elf target/${XOUS_TARGET_TRIPLE}/release/zeta`));
	});

	test('runOutOfTreeBuildInTerminal rejects a malformed crate name before any terminal work', async () => {
		await setCfg('buildTarget', 'dabao');
		const err = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		const ensure = sandbox.stub(terminalService, 'ensureNamedTerminal');

		await buildService.runOutOfTreeBuildInTerminal(tmpDir(), ['my;app $(x)']);

		assert.ok(ensure.notCalled, 'no terminal opened');
		assert.ok(
			err.getCalls().some((c) => String(c.args[0]).includes('Invalid crate name')),
			'the malformed name is reported',
		);
	});

	test('runOutOfTreeBuildInTerminal rejects a shell-active build target before any terminal work', async () => {
		await setCfg('buildTarget', 'dabao$(calc)');
		const err = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		const ensure = sandbox.stub(terminalService, 'ensureNamedTerminal');

		await buildService.runOutOfTreeBuildInTerminal(tmpDir(), ['hello']);

		assert.ok(err.calledOnce, 'invalid target is surfaced to the user');
		assert.ok(
			String(err.firstCall.args[0]).includes('dabao$(calc)'),
			`message names the bad value: ${err.firstCall.args[0]}`,
		);
		assert.ok(ensure.notCalled, 'no terminal is created and nothing is sent');
	});

	test('runOutOfTreeBuildInTerminal builds the board feature from a valid configured target', async () => {
		await setCfg('buildTarget', 'baosec');
		const root = tmpDir(); // no Cargo.toml: build command only
		const { sent, term } = fakeTerminal();
		sandbox.stub(terminalService, 'ensureNamedTerminal').returns(term);

		await buildService.runOutOfTreeBuildInTerminal(root, ['hello']);

		assert.equal(sent.length, 1);
		assert.ok(sent[0].includes('board-baosec'), `known target passes through: ${sent[0]}`);
	});

	/* ------------------------------ ensureBuildPrereqs ------------------------------ */

	test('ensureBuildPrereqs: an app that does not declare the target board is rejected', async () => {
		// It is right there in the tree, so the useful message is why it cannot build, not "missing".
		const { root } = makeFakeXousCore(tmpDir(), {
			target: 'baosec',
			apps: ['vault2'],
			unsupportedApps: ['dabao-console'],
		});
		await setCfg('buildTarget', 'baosec');
		await setCfg('xousAppName', 'dabao-console');

		sandbox.stub(rustCheckService, 'checkRustToolchain').resolves(true);
		sandbox.stub(projectModeService, 'getProjectMode').returns('xous-core');
		sandbox.stub(xousCoreService, 'resolveXousRootOrNotify').resolves(root);
		sandbox.stub(xousCoreService, 'ensureXousFolderOpen').resolves('ready');
		const err = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const result = await buildService.ensureBuildPrereqs();

		assert.equal(result, undefined, 'the build aborts rather than reaching cargo');
		const msg = String(err.firstCall.args[0]);
		assert.ok(msg.includes('board-baosec'), `the message names the feature: ${msg}`);
		assert.ok(msg.includes('dabao-console'), `and the app: ${msg}`);
	});

	/* ------------------------------ runBuildInTerminal ------------------------------ */

	test('runBuildInTerminal sends cargo xtask with the target and app words', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		const { sent, term } = fakeTerminal();
		sandbox.stub(terminalService, 'ensureNamedTerminal').returns(term);

		await buildService.runBuildInTerminal('C:\\fake\\root', 'dabao', 'hello world');

		assert.deepEqual(sent, ['cargo xtask dabao hello world']);
	});

	test('runBuildInTerminal rejects a build target outside the known list', async () => {
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		const ensure = sandbox.stub(terminalService, 'ensureNamedTerminal');

		await buildService.runBuildInTerminal('C:\\fake\\root', 'dabao; rm -rf ~', 'hello');

		assert.ok(ensure.notCalled, 'no terminal opened');
		assert.ok(String(errors.firstCall.args[0]).includes('Invalid hardware target'));
	});

	test('runBuildInTerminal rejects an app word with shell metacharacters', async () => {
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		const ensure = sandbox.stub(terminalService, 'ensureNamedTerminal');

		await buildService.runBuildInTerminal('C:\\fake\\root', 'dabao', 'hello $(evil)');

		assert.ok(ensure.notCalled, 'no terminal opened');
		assert.ok(String(errors.firstCall.args[0]).includes('Invalid app name'));
	});
});
