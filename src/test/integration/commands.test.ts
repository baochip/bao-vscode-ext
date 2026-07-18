import * as assert from 'node:assert';
import { Commands } from '@commands/commandIds';
import * as appService from '@services/appService';
import * as outOfTreeScaffoldService from '@services/outOfTreeScaffoldService';
import * as procService from '@services/procService';
import * as projectModeService from '@services/projectModeService';
import * as terminalService from '@services/terminalService';
import * as workspaceService from '@services/workspaceService';
import * as xousCoreService from '@services/xousCoreService';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import { activateExtension, resetBaochipConfig, useSandbox } from './helpers';

const cfg = () => vscode.workspace.getConfiguration('baochip');
const setCfg = (key: string, value: unknown) =>
	cfg().update(key, value, vscode.ConfigurationTarget.Workspace);

const XOUS_ROOT = 'C:\\fake\\xous-core';

suite('Command handlers (createApp, clean)', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	teardown(async () => {
		await resetBaochipConfig();
	});

	/* ------------------------------ New App (createApp) ------------------------------ */

	test('New App routes to the out-of-tree scaffolder in out-of-tree mode', async () => {
		sandbox.stub(projectModeService, 'getProjectMode').returns('out-of-tree');
		const scaffold = sandbox.stub(outOfTreeScaffoldService, 'scaffoldOutOfTreeApp').resolves();
		const createInTree = sandbox.stub(appService, 'createBaoApp');

		await vscode.commands.executeCommand(Commands.createApp);

		assert.ok(scaffold.calledOnce, 'out-of-tree scaffolder invoked');
		assert.ok(createInTree.notCalled, 'in-tree createBaoApp not used');
	});

	test('New App creates an in-tree app at the adopted root, saves it, and reveals it', async () => {
		sandbox.stub(projectModeService, 'getProjectMode').returns('xous-core');
		sandbox.stub(xousCoreService, 'resolveXousRootOrNotify').resolves(XOUS_ROOT);
		// The user adopts a different open folder; createApp must operate on the returned root.
		sandbox.stub(workspaceService, 'ensureXousWorkspaceOpen').resolves('C:\\fake\\adopted');
		sandbox.stub(vscode.window, 'showInputBox').resolves('My_App'); // lowercased by the handler
		const create = sandbox.stub(appService, 'createBaoApp').resolves(true);
		const reveal = sandbox.stub(workspaceService, 'revealAppFolder').resolves();
		sandbox.stub(vscode.window, 'showInformationMessage');

		await vscode.commands.executeCommand(Commands.createApp);

		assert.ok(
			create.calledOnceWithExactly('C:\\fake\\adopted', 'my_app', 'dabao'),
			'createBaoApp uses the adopted root, the lowercased name, and the default target',
		);
		assert.ok(reveal.calledOnceWithExactly('C:\\fake\\adopted', 'my_app', 'dabao'), 'app revealed');
		assert.equal(cfg().get<string>('xousAppName'), 'my_app', 'new app saved as current');
	});

	test('New App refuses the baosec target (not yet supported)', async () => {
		await setCfg('buildTarget', 'baosec');
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		const scaffold = sandbox.stub(outOfTreeScaffoldService, 'scaffoldOutOfTreeApp');
		const create = sandbox.stub(appService, 'createBaoApp');

		await vscode.commands.executeCommand(Commands.createApp);

		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('baosec app creation is not yet')),
			'baosec-not-supported error shown',
		);
		assert.ok(scaffold.notCalled && create.notCalled, 'nothing created for baosec');
	});

	/* ------------------------------ Clean ------------------------------ */

	test('Clean confirms, then opens a terminal at the xous-core root and runs cargo clean', async () => {
		sandbox.stub(projectModeService, 'getProjectMode').returns('xous-core');
		sandbox.stub(xousCoreService, 'resolveXousRootOrNotify').resolves(XOUS_ROOT);
		const warnings = sandbox.stub(
			vscode.window,
			'showWarningMessage',
		) as unknown as sinon.SinonStub;
		warnings.resolves('Clean');
		const term = { sendText: sandbox.spy(), show: sandbox.spy() };
		const ensureTerm = sandbox
			.stub(terminalService, 'ensureNamedTerminal')
			.returns(term as unknown as vscode.Terminal);

		await vscode.commands.executeCommand(Commands.clean);

		assert.equal(warnings.callCount, 1, 'one confirmation');
		const [msg, opts] = warnings.firstCall.args as [string, vscode.MessageOptions];
		assert.ok(String(msg).includes('cargo clean'), 'confirmation names cargo clean');
		assert.ok(opts.modal, 'confirmation is modal');
		assert.ok(String(opts.detail).includes(XOUS_ROOT), 'detail names the project root');
		assert.ok(ensureTerm.calledOnce, 'terminal ensured');
		assert.equal(ensureTerm.firstCall.args[1], XOUS_ROOT, 'terminal cwd is the xous-core root');
		assert.ok(term.sendText.calledOnceWith('cargo clean'), 'cargo clean sent');
		assert.ok(term.show.calledOnce, 'terminal shown');
	});

	test('Clean runs nothing when the confirmation is dismissed', async () => {
		sandbox.stub(projectModeService, 'getProjectMode').returns('xous-core');
		sandbox.stub(xousCoreService, 'resolveXousRootOrNotify').resolves(XOUS_ROOT);
		(sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub).resolves(
			undefined,
		);
		const ensureTerm = sandbox.stub(terminalService, 'ensureNamedTerminal');

		await vscode.commands.executeCommand(Commands.clean);

		assert.ok(ensureTerm.notCalled, 'no terminal opened after cancel');
	});

	test('Clean does nothing when the xous-core root cannot be resolved', async () => {
		sandbox.stub(projectModeService, 'getProjectMode').returns('xous-core');
		sandbox.stub(xousCoreService, 'resolveXousRootOrNotify').resolves(undefined);
		const warnings = sandbox.stub(
			vscode.window,
			'showWarningMessage',
		) as unknown as sinon.SinonStub;
		const ensureTerm = sandbox.stub(terminalService, 'ensureNamedTerminal');

		await vscode.commands.executeCommand(Commands.clean);

		assert.ok(warnings.notCalled, 'no confirmation without a root');
		assert.ok(ensureTerm.notCalled, 'no terminal opened without a root');
	});

	test('Clean shows the Rust-not-found toast and opens no terminal when cargo is unavailable', async () => {
		sandbox.stub(projectModeService, 'getProjectMode').returns('xous-core');
		sandbox.stub(xousCoreService, 'resolveXousRootOrNotify').resolves(XOUS_ROOT);
		// rustc probing fails, so the toolchain preflight aborts before any confirmation or terminal.
		sandbox.stub(procService, 'runProcess').resolves({
			code: null,
			stdout: '',
			stderr: '',
			cancelled: false,
			error: new Error('not found'),
		});
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		const warnings = sandbox.stub(
			vscode.window,
			'showWarningMessage',
		) as unknown as sinon.SinonStub;
		const ensureTerm = sandbox.stub(terminalService, 'ensureNamedTerminal');

		await vscode.commands.executeCommand(Commands.clean);

		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('Rust not found')),
			'Rust-not-found toast shown',
		);
		assert.ok(warnings.notCalled, 'no clean confirmation without a toolchain');
		assert.ok(ensureTerm.notCalled, 'no terminal opened without a toolchain');
	});
});
