import * as assert from 'node:assert';
import * as baoRunnerService from '@services/baoRunnerService';
import * as bootService from '@services/bootService';
import * as logService from '@services/logService';
import * as monitorService from '@services/monitorService';
import * as portsService from '@services/portsService';
import * as procService from '@services/procService';
import * as uvService from '@services/uvService';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import { activateExtension, fakeChannel, resetBaochipConfig, useSandbox } from './helpers';

const cfg = () => vscode.workspace.getConfiguration('baochip');
const setCfg = (key: string, value: unknown) =>
	cfg().update(key, value, vscode.ConfigurationTarget.Workspace);

const PORTS_OUTPUT = 'COM3\tUSB Serial Device\nCOM7\tBaochip DaBao';

type PortItem = vscode.QuickPickItem & { port?: string };

/** Scriptable stand-in for the live port picker: captures state, fires handlers on demand. */
class FakePortPicker {
	title: string | undefined;
	placeholder: string | undefined;
	ignoreFocusOut = false;
	busy = false;
	items: readonly PortItem[] = [];
	activeItems: readonly PortItem[] = [];
	selectedItems: readonly PortItem[] = [];
	buttons: readonly vscode.QuickInputButton[] = [];
	visible = false;
	disposed = false;
	private handlers: {
		accept?: () => unknown;
		hide?: () => unknown;
		button?: (b: vscode.QuickInputButton) => unknown;
	} = {};

	onDidAccept(h: () => unknown) {
		this.handlers.accept = h;
		return { dispose() {} };
	}
	onDidHide(h: () => unknown) {
		this.handlers.hide = h;
		return { dispose() {} };
	}
	onDidTriggerButton(h: (b: vscode.QuickInputButton) => unknown) {
		this.handlers.button = h;
		return { dispose() {} };
	}
	show() {
		this.visible = true;
	}
	hide() {
		this.visible = false;
		this.handlers.hide?.();
	}
	dispose() {
		this.disposed = true;
	}

	/** Test driver: select an item and press Enter. */
	accept(item: PortItem) {
		this.selectedItems = [item];
		this.handlers.accept?.();
	}
	/** Test driver: dismiss without accepting (Escape). */
	dismiss() {
		this.hide();
	}
	/** Test driver: click the title-bar refresh button. */
	pressRefresh() {
		this.handlers.button?.(this.buttons[0]);
	}
}

function stubPortPicker(sandbox: sinon.SinonSandbox): FakePortPicker {
	const qp = new FakePortPicker();
	sandbox
		.stub(vscode.window, 'createQuickPick')
		.returns(qp as unknown as vscode.QuickPick<vscode.QuickPickItem>);
	return qp;
}

/** Poll the event loop until cond() holds - the picker's enumeration runs fire-and-forget. */
async function until(cond: () => boolean): Promise<void> {
	for (let i = 0; i < 100 && !cond(); i++) {
		await new Promise((r) => setTimeout(r, 0));
	}
	assert.ok(cond(), 'condition not reached in time');
}

suite('Ports, monitor, and boot', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	teardown(async () => {
		monitorService.stopMonitorTTY();
		await resetBaochipConfig();
	});

	/* ------------------------------ promptAndSaveSerialPort ------------------------------ */

	test('promptAndSaveSerialPort saves the picked run port under the run key', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		sandbox.stub(baoRunnerService, 'runBaoCmd').resolves(PORTS_OUTPUT);
		const qp = stubPortPicker(sandbox);

		const pending = portsService.promptAndSaveSerialPort('run');
		await until(() => qp.items.length > 0 && !qp.busy);

		assert.equal(qp.ignoreFocusOut, true, 'picker survives focus loss while handling the board');
		assert.ok(String(qp.title).includes('PROG'), `run-mode guidance in the title: ${qp.title}`);
		assert.deepEqual(
			qp.items.map((i) => i.label),
			['COM3', 'COM7'],
		);
		assert.equal(qp.items[0].description, 'USB Serial Device', 'description from second column');
		qp.accept(qp.items[1]);
		const port = await pending;

		assert.equal(port, 'COM7');
		assert.equal(cfg().get<string>('serialPortRun'), 'COM7');
		assert.equal(cfg().get<string>('serialPortBootloader') || '', '', 'bootloader key untouched');
		assert.ok(qp.disposed, 'picker disposed after accepting');
	});

	test('promptAndSaveSerialPort saves the picked bootloader port under the bootloader key', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		sandbox.stub(baoRunnerService, 'runBaoCmd').resolves(PORTS_OUTPUT);
		const qp = stubPortPicker(sandbox);

		const pending = portsService.promptAndSaveSerialPort('bootloader');
		await until(() => qp.items.length > 0 && !qp.busy);

		assert.ok(String(qp.title).includes('RESET'), `bootloader guidance in the title: ${qp.title}`);
		qp.accept(qp.items[0]);
		const port = await pending;

		assert.equal(port, 'COM3');
		assert.equal(cfg().get<string>('serialPortBootloader'), 'COM3');
		assert.equal(cfg().get<string>('serialPortRun') || '', '', 'run key untouched');
	});

	test('promptAndSaveSerialPort: dismissing the picker saves nothing', async () => {
		sandbox.stub(baoRunnerService, 'runBaoCmd').resolves(PORTS_OUTPUT);
		const qp = stubPortPicker(sandbox);

		const pending = portsService.promptAndSaveSerialPort('run');
		await until(() => qp.items.length > 0 && !qp.busy);
		qp.dismiss();
		const port = await pending;

		assert.equal(port, undefined);
		assert.equal(cfg().get<string>('serialPortRun') || '', '', 'nothing saved');
		assert.ok(qp.disposed, 'picker disposed after dismissal');
	});

	test('promptAndSaveSerialPort preselects a lone port so Enter accepts it', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		sandbox.stub(baoRunnerService, 'runBaoCmd').resolves('COM7\tBaochip DaBao');
		const qp = stubPortPicker(sandbox);

		const pending = portsService.promptAndSaveSerialPort('run');
		await until(() => qp.items.length > 0 && !qp.busy);

		assert.equal(qp.activeItems.length, 1, 'lone port highlighted');
		assert.equal(qp.activeItems[0].label, 'COM7');
		qp.accept(qp.activeItems[0]);
		assert.equal(await pending, 'COM7');
	});

	test('the refresh button re-enumerates the ports', async () => {
		const runBao = sandbox.stub(baoRunnerService, 'runBaoCmd');
		runBao.onFirstCall().resolves('COM3\tUSB Serial Device');
		runBao.onSecondCall().resolves(PORTS_OUTPUT);
		const qp = stubPortPicker(sandbox);

		const pending = portsService.promptAndSaveSerialPort('run');
		await until(() => qp.items.length === 1 && !qp.busy);
		qp.pressRefresh();
		await until(() => qp.items.length === 2 && !qp.busy);

		assert.equal(runBao.callCount, 2, 'ports re-enumerated');
		qp.dismiss();
		await pending;
	});

	test('promptAndSaveSerialPort shows a no-ports hint row instead of port items', async () => {
		sandbox.stub(baoRunnerService, 'runBaoCmd').resolves('');
		const qp = stubPortPicker(sandbox);

		const pending = portsService.promptAndSaveSerialPort('run');
		await until(() => qp.items.length > 0 && !qp.busy);

		assert.equal(qp.items.length, 1, 'a single hint row');
		assert.ok(String(qp.items[0].label).includes('No serial ports found'), 'hint labels the state');
		assert.equal(qp.items[0].port, undefined, 'the hint is not a pickable port');
		qp.dismiss();
		assert.equal(await pending, undefined);
	});

	test('accepting the no-ports hint re-enumerates and continues to a real pick', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		const runBao = sandbox.stub(baoRunnerService, 'runBaoCmd');
		runBao.onFirstCall().resolves(''); // board not plugged in yet
		runBao.onSecondCall().resolves(PORTS_OUTPUT);
		const qp = stubPortPicker(sandbox);

		const pending = portsService.promptAndSaveSerialPort('run');
		await until(() => qp.items.length > 0 && !qp.busy);
		qp.accept(qp.items[0]); // Enter on the hint = retry
		await until(() => qp.items.length === 2 && !qp.busy);
		qp.accept(qp.items[1]);
		const port = await pending;

		assert.equal(port, 'COM7');
		assert.equal(cfg().get<string>('serialPortRun'), 'COM7');
		assert.equal(runBao.callCount, 2, 'ports re-enumerated after the hint was accepted');
	});

	test('promptAndSaveSerialPort surfaces a ports-listing failure with a single toast', async () => {
		sandbox.stub(baoRunnerService, 'runBaoCmd').rejects(new Error('bao.py exploded'));
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		const qp = stubPortPicker(sandbox);

		const port = await portsService.promptAndSaveSerialPort('run');

		assert.equal(port, undefined);
		assert.equal(errors.callCount, 1, 'exactly one error toast');
		assert.ok(String(errors.firstCall.args[0]).includes('Could not list ports'));
		assert.ok(qp.disposed, 'picker closed on a listing failure');
	});

	/* ------------------------------ ensureSerialPort ------------------------------ */

	test('ensureSerialPort returns a configured port without prompting', async () => {
		await setCfg('serialPortRun', 'COM9');
		const create = sandbox.stub(vscode.window, 'createQuickPick');

		const port = await portsService.ensureSerialPort('run');

		assert.equal(port, 'COM9');
		assert.ok(create.notCalled, 'no picker for a configured port');
	});

	test('ensureSerialPort prompts when unset and returns the freshly saved port', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		sandbox.stub(baoRunnerService, 'runBaoCmd').resolves(PORTS_OUTPUT);
		const qp = stubPortPicker(sandbox);

		const pending = portsService.ensureSerialPort('run');
		await until(() => qp.items.length > 0 && !qp.busy);
		qp.accept(qp.items[1]);
		const port = await pending;

		assert.equal(port, 'COM7', 'continues in the same run with the fresh pick');
		assert.equal(cfg().get<string>('serialPortRun'), 'COM7');
	});

	/* ------------------------------ waitForPort ------------------------------ */

	test("waitForPort returns 'found' once the port shows up", async () => {
		let calls = 0;
		const runBao = async () => (++calls >= 3 ? 'COM7\tBaochip' : 'COM3\tOther');

		const result = await portsService.waitForPort(runBao, 'COM7', {
			timeoutMs: 2000,
			intervalMs: 1,
		});

		assert.equal(result, 'found');
		assert.equal(calls, 3);
	});

	test("waitForPort returns 'timeout' when the port never appears", async () => {
		const runBao = async () => 'COM3\tOther';

		const result = await portsService.waitForPort(runBao, 'COM7', {
			timeoutMs: 30,
			intervalMs: 5,
		});

		assert.equal(result, 'timeout');
	});

	test("waitForPort returns 'error' with one error toast after persistent listing failures", async () => {
		let calls = 0;
		const runBao = async (): Promise<string> => {
			calls++;
			throw new Error('bao.py broken');
		};
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const result = await portsService.waitForPort(runBao, 'COM7', {
			timeoutMs: 5000,
			intervalMs: 1,
		});

		assert.equal(result, 'error');
		assert.equal(calls, 3, 'bails after three consecutive failures, not the full timeout');
		assert.equal(errors.callCount, 1, 'exactly one error toast');
		assert.ok(String(errors.firstCall.args[0]).includes('Could not list ports'));
	});

	test("waitForPort returns 'cancelled' with no error toast when the token is cancelled", async () => {
		const token = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose() {} }),
		};
		const runBao = async (): Promise<string> => {
			token.isCancellationRequested = true; // the probe is killed by the cancel and throws
			throw new Error('killed');
		};
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const result = await portsService.waitForPort(runBao, 'COM7', {
			timeoutMs: 5000,
			intervalMs: 1,
			token: token as unknown as vscode.CancellationToken,
		});

		assert.equal(result, 'cancelled');
		assert.ok(errors.notCalled, 'a cancel is not surfaced as a ports-listing error');
	});

	test('waitForPort threads the cancellation token through to the ports probe', async () => {
		const token = {
			isCancellationRequested: false,
			onCancellationRequested: () => ({ dispose() {} }),
		} as unknown as vscode.CancellationToken;
		let received: vscode.CancellationToken | undefined;
		const runBao = async (
			_args: string[],
			_cwd?: string,
			opts?: { token?: vscode.CancellationToken },
		) => {
			received = opts?.token;
			return 'COM7\tBaochip';
		};

		const result = await portsService.waitForPort(runBao, 'COM7', {
			timeoutMs: 100,
			intervalMs: 1,
			token,
		});

		assert.equal(result, 'found');
		assert.equal(received, token, 'the same token reaches the underlying ports probe');
	});

	test('runBaoCmd treats a cancelled run as a cancel, not a bao.py failure toast', async () => {
		sandbox.stub(uvService, 'getBaoRunner').resolves({ cmd: 'uv', args: ['run', 'python'] });
		sandbox.stub(uvService, 'ensureBaoPythonDeps').resolves();
		sandbox
			.stub(procService, 'runProcess')
			.resolves({ code: null, stdout: '', stderr: '', cancelled: true });
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		await assert.rejects(
			baoRunnerService.runBaoCmd(['ports'], undefined, { capture: true }),
			/cancel/i,
			'a cancelled run rejects as a cancel, not "exited null"',
		);
		assert.ok(errors.notCalled, 'no bao.py-failed toast on cancel');
	});

	/* ------------------------------ openMonitorTTY ------------------------------ */

	interface FakeTerminal {
		sendText: sinon.SinonSpy;
		show: sinon.SinonSpy;
		dispose: sinon.SinonSpy;
	}

	// The monitor terminal runs uv directly via shellPath/shellArgs (no shell parses a command
	// line), so the fakes capture createTerminal options instead of sent text.
	function stubMonitorTerminal(cmd = 'uv') {
		const terminals: FakeTerminal[] = [];
		const create = (
			sandbox.stub(vscode.window, 'createTerminal') as unknown as sinon.SinonStub
		).callsFake(() => {
			const term: FakeTerminal = {
				sendText: sandbox.spy(),
				show: sandbox.spy(),
				dispose: sandbox.spy(),
			};
			terminals.push(term);
			return term as unknown as vscode.Terminal;
		});
		sandbox.stub(uvService, 'getBaoRunner').resolves({ cmd, args: ['run', 'python'] });
		sandbox.stub(baoRunnerService, 'resolveBaoPy').returns('C:\\fake\\bao.py');
		sandbox.stub(uvService, 'uvEnv').returns({ BAO_TEST_ENV: 'sentinel' });
		const deps = sandbox.stub(uvService, 'ensureBaoPythonDeps').resolves();
		const optionsOf = (call: number) =>
			create.getCall(call).args[0] as vscode.TerminalOptions & { shellArgs?: string[] };
		return { terminals, create, optionsOf, deps };
	}

	test('openMonitorTTY launches bao.py monitor with the port, baud, and default flags', async () => {
		const ensurePort = sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { terminals, create, optionsOf } = stubMonitorTerminal();

		await monitorService.openMonitorTTY('run');

		assert.ok(ensurePort.calledOnceWith('run'));
		assert.ok(create.calledOnce, 'terminal created');
		const opts = optionsOf(0);
		assert.equal(opts.shellPath, 'uv', 'uv is the terminal process');
		assert.deepEqual(
			opts.shellArgs,
			[
				'run',
				'python',
				'C:\\fake\\bao.py',
				'monitor',
				'-p',
				'COM5',
				'-b',
				'1000000',
				'--crlf',
				'--raw',
				'--no-echo',
			],
			'argv with port, baud, and default flags',
		);
		assert.ok(terminals[0].sendText.notCalled, 'no command line typed into the terminal');
		assert.ok(terminals[0].show.calledOnce, 'terminal shown');
	});

	test('openMonitorTTY honors the monitor flag settings', async () => {
		await setCfg('monitor.crlf', false);
		await setCfg('monitor.raw', false);
		await setCfg('monitor.echo', true);
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { optionsOf } = stubMonitorTerminal();

		await monitorService.openMonitorTTY('run');

		const shellArgs = optionsOf(0).shellArgs ?? [];
		assert.deepEqual(
			shellArgs.slice(-3),
			['--no-crlf', '--no-raw', '--echo'],
			'explicit off/on forms passed so bao.py defaults cannot win',
		);
	});

	test('openMonitorTTY passes a uv path containing spaces verbatim (A17 regression)', async () => {
		const spacedUv = 'C:\\Users\\Jean Doe\\AppData\\globalStorage\\uv\\uv.exe';
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { optionsOf } = stubMonitorTerminal(spacedUv);

		await monitorService.openMonitorTTY('run');

		const opts = optionsOf(0);
		assert.equal(opts.shellPath, spacedUv, 'path reaches the terminal unmodified');
		assert.ok(!String(opts.shellPath).includes('"'), 'no shell quoting applied');
	});

	test('openMonitorTTY passes the contained uv environment to the terminal', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { optionsOf } = stubMonitorTerminal();

		await monitorService.openMonitorTTY('run');

		assert.equal(optionsOf(0).env?.BAO_TEST_ENV, 'sentinel', 'uvEnv() reaches the terminal');
	});

	test('openMonitorTTY interrupts and disposes the previous monitor terminal on reopen', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { terminals, create } = stubMonitorTerminal();

		await monitorService.openMonitorTTY('run');
		await monitorService.openMonitorTTY('run');

		assert.equal(create.callCount, 2, 'a fresh terminal per open');
		assert.ok(
			terminals[0].sendText.calledOnceWith('\x03', false),
			'Ctrl+C (no trailing newline) sent to the old monitor',
		);
		assert.ok(terminals[0].dispose.calledOnce, 'old terminal disposed');
		assert.ok(terminals[1].sendText.notCalled, 'new terminal receives no typed command');
	});

	test('the monitor close-terminal listener is disposed on reopen and on stop (no leak)', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		stubMonitorTerminal();
		const listenerDisposes: sinon.SinonSpy[] = [];
		(sandbox.stub(vscode.window, 'onDidCloseTerminal') as unknown as sinon.SinonStub).callsFake(
			() => {
				const dispose = sandbox.spy();
				listenerDisposes.push(dispose);
				return { dispose } as vscode.Disposable;
			},
		);

		await monitorService.openMonitorTTY('run');
		await monitorService.openMonitorTTY('run');
		assert.equal(listenerDisposes.length, 2, 'a listener registered per open');
		assert.ok(listenerDisposes[0].calledOnce, 'previous listener disposed on reopen');
		assert.ok(listenerDisposes[1].notCalled, 'current listener still active after reopen');

		monitorService.stopMonitorTTY();
		assert.ok(listenerDisposes[1].calledOnce, 'current listener disposed on stop');
	});

	test('openMonitorTTY without a mode uses the default monitor port preference', async () => {
		await setCfg('monitorDefaultPort', 'bootloader');
		const ensurePort = sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		stubMonitorTerminal();

		await monitorService.openMonitorTTY();

		assert.ok(ensurePort.calledOnceWith('bootloader'), 'default preference used');
	});

	test('openMonitorTTY opens no terminal when no port is resolved', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves(undefined);
		const { create, deps } = stubMonitorTerminal();

		await monitorService.openMonitorTTY('run');

		assert.ok(create.notCalled, 'no terminal without a port');
		assert.ok(deps.notCalled, 'no dependency work when the port prompt is cancelled');
	});

	test('openMonitorTTY ensures Python deps before creating the terminal', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { create, deps } = stubMonitorTerminal();

		await monitorService.openMonitorTTY('run');

		assert.ok(deps.calledOnce, 'deps ensured');
		assert.ok(deps.calledBefore(create), 'venv ready before bao.py launches');
	});

	test('openMonitorTTY still opens the terminal when the deps check fails', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { create, deps } = stubMonitorTerminal();
		deps.rejects(new Error('uv install failed'));

		await monitorService.openMonitorTTY('run');

		assert.ok(create.calledOnce, 'launch proceeds so the real error stays visible');
	});

	/* ------------------------------ sendBoot ------------------------------ */

	test('sendBoot aborts silently when the bootloader port stays unset', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves(undefined);
		const deps = sandbox.stub(uvService, 'ensureBaoPythonDeps').resolves();
		const { chan } = fakeChannel();
		sandbox.stub(logService, 'getBaochipChannel').returns(chan);
		const warnings = sandbox.stub(
			vscode.window,
			'showWarningMessage',
		) as unknown as sinon.SinonStub;

		const ok = await bootService.sendBoot();

		assert.equal(ok, false);
		// Aligns with the monitor: no extra warning (ensureSerialPort already surfaces failures), so a
		// listing failure during the pick does not stack an error + a warning for one root cause.
		assert.ok(warnings.notCalled, 'aborts silently, no double notification');
		assert.ok(deps.notCalled, 'no dependency work when the port prompt is cancelled');
	});

	test('sendBoot runs bao.py under the contained uv environment', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM7');
		sandbox.stub(uvService, 'getBaoRunner').resolves({ cmd: 'uv', args: ['run', 'python'] });
		sandbox.stub(uvService, 'uvEnv').returns({ BAO_TEST_ENV: 'sentinel' });
		sandbox.stub(uvService, 'ensureBaoPythonDeps').resolves();
		const run = sandbox
			.stub(procService, 'runProcess')
			.resolves({ code: 0, stdout: '', stderr: '', cancelled: false });
		const { chan } = fakeChannel();
		sandbox.stub(logService, 'getBaochipChannel').returns(chan);

		const ok = await bootService.sendBoot();

		assert.equal(ok, true);
		const opts = run.firstCall.args[2] as procService.RunOptions;
		assert.equal(opts.env?.BAO_TEST_ENV, 'sentinel', 'uvEnv() reaches the boot process');
	});

	test('sendBoot ensures Python deps before running bao.py', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM7');
		sandbox.stub(uvService, 'getBaoRunner').resolves({ cmd: 'uv', args: ['run', 'python'] });
		const deps = sandbox.stub(uvService, 'ensureBaoPythonDeps').resolves();
		const run = sandbox
			.stub(procService, 'runProcess')
			.resolves({ code: 0, stdout: '', stderr: '', cancelled: false });
		const { chan } = fakeChannel();
		sandbox.stub(logService, 'getBaochipChannel').returns(chan);

		const ok = await bootService.sendBoot();

		assert.equal(ok, true);
		assert.ok(deps.calledOnce, 'deps ensured');
		assert.ok(deps.calledBefore(run), 'venv ready before bao.py runs');
	});

	test('sendBoot still boots when the deps check fails', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM7');
		sandbox.stub(uvService, 'getBaoRunner').resolves({ cmd: 'uv', args: ['run', 'python'] });
		sandbox.stub(uvService, 'ensureBaoPythonDeps').rejects(new Error('uv install failed'));
		const run = sandbox
			.stub(procService, 'runProcess')
			.resolves({ code: 0, stdout: '', stderr: '', cancelled: false });
		const { chan } = fakeChannel();
		sandbox.stub(logService, 'getBaochipChannel').returns(chan);

		const ok = await bootService.sendBoot();

		assert.equal(ok, true, 'launch proceeds so the real error stays visible');
		assert.ok(run.calledOnce, 'bao.py still invoked');
	});

	test('sendBoot surfaces a failed boot command with its stderr', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM7');
		sandbox.stub(uvService, 'getBaoRunner').resolves({ cmd: 'uv', args: ['run', 'python'] });
		sandbox.stub(uvService, 'ensureBaoPythonDeps').resolves();
		sandbox
			.stub(procService, 'runProcess')
			.resolves({ code: 2, stdout: '', stderr: 'cannot open COM7', cancelled: false });
		const { lines, chan } = fakeChannel();
		sandbox.stub(logService, 'getBaochipChannel').returns(chan);
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const ok = await bootService.sendBoot();

		assert.equal(ok, false);
		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('cannot open COM7')),
			'stderr surfaced in the failure toast',
		);
		assert.ok(
			lines.some((l) => l.includes('Boot command failed')),
			'failure logged to the channel',
		);
	});
});
