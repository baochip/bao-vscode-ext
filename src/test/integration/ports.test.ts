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

const PORTS_OUTPUT = 'COM3\tUSB Serial Device\nCOM7\tBaochip Dabao';

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

/** Wait until cond() holds - the picker's enumeration and background polling run on real time. */
async function until(cond: () => boolean, timeoutMs = 5000): Promise<void> {
	const start = Date.now();
	while (!cond() && Date.now() - start < timeoutMs) {
		await new Promise((r) => setTimeout(r, 25));
	}
	assert.ok(cond(), 'condition not reached in time');
}

function deferred<T>() {
	let resolve!: (v: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
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

		assert.equal(qp.ignoreFocusOut, false, 'standard picker: Escape and click-away both dismiss');
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
		sandbox.stub(baoRunnerService, 'runBaoCmd').resolves('COM7\tBaochip Dabao');
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

	test('the picker re-enumerates on its own while open (no user action)', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		const runBao = sandbox.stub(baoRunnerService, 'runBaoCmd');
		runBao.onFirstCall().resolves(''); // board not plugged in yet
		runBao.resolves(PORTS_OUTPUT); // every later poll sees the board
		const qp = stubPortPicker(sandbox);

		const pending = portsService.promptAndSaveSerialPort('run');
		await until(() => qp.items.length === 1 && !qp.busy);
		// No refresh click, no hint accept: the background poll must pick the board up by itself.
		await until(() => qp.items.length === 2);
		qp.accept(qp.items[1]);

		assert.equal(await pending, 'COM7');
		assert.ok(runBao.callCount >= 2, 'the picker polled without user action');
	});

	test('a refresh requested mid-enumeration is queued, not dropped', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		const first = deferred<string>();
		const runBao = sandbox.stub(baoRunnerService, 'runBaoCmd');
		runBao.onFirstCall().returns(first.promise); // initial enumeration hangs
		runBao.resolves(PORTS_OUTPUT);
		const qp = stubPortPicker(sandbox);

		const pending = portsService.promptAndSaveSerialPort('run');
		await until(() => runBao.callCount === 1);
		qp.pressRefresh(); // arrives while the first enumeration is still running
		first.resolve(''); // first listing: empty

		// The queued refresh must run and deliver the real listing.
		await until(() => qp.items.length === 2);
		qp.accept(qp.items[1]);
		assert.equal(await pending, 'COM7');
		assert.ok(runBao.callCount >= 2, 'the mid-flight refresh request ran after the first finished');
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

	test('a background poll failure stays silent and keeps the picker open', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;
		const runBao = sandbox.stub(baoRunnerService, 'runBaoCmd');
		runBao.onFirstCall().resolves(PORTS_OUTPUT);
		runBao.onSecondCall().rejects(new Error('transient hiccup')); // first background poll
		runBao.resolves(PORTS_OUTPUT);
		const qp = stubPortPicker(sandbox);

		const pending = portsService.promptAndSaveSerialPort('run');
		await until(() => qp.items.length === 2 && !qp.busy);
		// Wait for the failing poll and one more good one - the picker must ride through both.
		await until(() => runBao.callCount >= 3, 8000);

		assert.ok(!qp.disposed && qp.visible, 'picker survived the transient poll failure');
		assert.ok(errors.notCalled, 'no toast for a background hiccup');
		qp.accept(qp.items[1]);
		assert.equal(await pending, 'COM7');
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

	/* ------------------------------ isPortPresent / offerRepickMissingPort ------------------------------ */

	test('isPortPresent reports presence, absence, and unknown-on-failure', async () => {
		const runBao = sandbox.stub(baoRunnerService, 'runBaoCmd').resolves(PORTS_OUTPUT);
		assert.equal(await portsService.isPortPresent('COM7'), true);
		assert.equal(await portsService.isPortPresent('COM9'), false);
		runBao.rejects(new Error('bao.py exploded'));
		assert.equal(await portsService.isPortPresent('COM7'), null, 'a listing failure is unknown');
	});

	test('offerRepickMissingPort names the port and returns the fresh pick', async () => {
		sandbox.stub(vscode.window, 'showInformationMessage');
		const warnings = sandbox.stub(
			vscode.window,
			'showWarningMessage',
		) as unknown as sinon.SinonStub;
		warnings.resolves('Pick a different port');
		sandbox.stub(baoRunnerService, 'runBaoCmd').resolves(PORTS_OUTPUT);
		const qp = stubPortPicker(sandbox);

		const pending = portsService.offerRepickMissingPort('run', 'COM9');
		await until(() => qp.items.length === 2 && !qp.busy);
		qp.accept(qp.items[1]);

		assert.equal(await pending, 'COM7');
		assert.equal(cfg().get<string>('serialPortRun'), 'COM7', 'fresh pick saved');
		const msg = String(warnings.firstCall.args[0]);
		assert.ok(msg.includes('COM9') && msg.includes('run mode'), `warning names the port: ${msg}`);
	});

	test('offerRepickMissingPort returns undefined when the warning is dismissed', async () => {
		(sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub).resolves(
			undefined,
		);
		const create = sandbox.stub(vscode.window, 'createQuickPick');

		assert.equal(await portsService.offerRepickMissingPort('run', 'COM9'), undefined);
		assert.ok(create.notCalled, 'no picker after a dismissal');
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

	test('runBaoCmd quiet skips the heartbeat log lines but still logs failures', async () => {
		sandbox.stub(uvService, 'getBaoRunner').resolves({ cmd: 'uv', args: ['run', 'python'] });
		sandbox.stub(uvService, 'ensureBaoPythonDeps').resolves();
		const logSpy = sandbox.stub(logService, 'log');
		const run = sandbox
			.stub(procService, 'runProcess')
			.resolves({ code: 0, stdout: 'COM7\tBaochip', stderr: '', cancelled: false });

		await baoRunnerService.runBaoCmd(['ports'], undefined, { capture: true, quiet: true });
		assert.ok(
			logSpy.getCalls().every((c) => !/INVOKE|EXIT|resolved/.test(String(c.args[0]))),
			`no heartbeat lines when quiet: ${logSpy.getCalls().map((c) => c.args[0])}`,
		);

		run.resolves({ code: 1, stdout: '', stderr: 'boom', cancelled: false });
		await assert.rejects(
			baoRunnerService.runBaoCmd(['ports'], undefined, { capture: true, quiet: true }),
		);
		assert.ok(
			logSpy.getCalls().some((c) => String(c.args[0]).includes('EXIT 1')),
			'a failing exit is still logged even when quiet',
		);
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
		shellIntegration?: { executeCommand: sinon.SinonSpy };
	}

	// The monitor runs in a regular shell terminal so Ctrl+C returns the user to their prompt.
	// With shell integration the command goes through executeCommand (shell-correct quoting);
	// without it (cmd, or integration disabled) the command is typed. Fakes capture both paths.
	function stubMonitorTerminal(opts: { cmd?: string; withIntegration?: boolean } = {}) {
		const { cmd = 'uv', withIntegration = true } = opts;
		const terminals: FakeTerminal[] = [];
		const create = (
			sandbox.stub(vscode.window, 'createTerminal') as unknown as sinon.SinonStub
		).callsFake(() => {
			const term: FakeTerminal = {
				sendText: sandbox.spy(),
				show: sandbox.spy(),
				dispose: sandbox.spy(),
			};
			if (withIntegration) term.shellIntegration = { executeCommand: sandbox.spy() };
			terminals.push(term);
			return term as unknown as vscode.Terminal;
		});
		sandbox.stub(uvService, 'getBaoRunner').resolves({ cmd, args: ['run', 'python'] });
		sandbox.stub(baoRunnerService, 'resolveBaoPy').returns('C:\\fake\\bao.py');
		sandbox.stub(uvService, 'uvEnv').returns({ BAO_TEST_ENV: 'sentinel' });
		const deps = sandbox.stub(uvService, 'ensureBaoPythonDeps').resolves();
		const present = sandbox.stub(portsService, 'isPortPresent').resolves(true);
		const repick = sandbox.stub(portsService, 'offerRepickMissingPort').resolves(undefined);
		const optionsOf = (call: number) => create.getCall(call).args[0] as vscode.TerminalOptions;
		const executedOf = (call: number) =>
			terminals[call].shellIntegration?.executeCommand.firstCall?.args as [string, string[]];
		return { terminals, create, optionsOf, executedOf, deps, present, repick };
	}

	test('openMonitorTTY runs bao.py monitor via shell integration with port, baud, and flags', async () => {
		const ensurePort = sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { terminals, create, executedOf } = stubMonitorTerminal();

		await monitorService.openMonitorTTY('run');

		assert.ok(ensurePort.calledOnceWith('run'));
		assert.ok(create.calledOnce, 'terminal created');
		const [exe, args] = executedOf(0);
		assert.equal(exe, 'uv', 'uv handed to shell integration unquoted');
		assert.deepEqual(
			args,
			[
				'run',
				'--project',
				uvService.getGlobalVenvRoot(),
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
			'argv with the venv project, port, baud, and default flags',
		);
		assert.ok(terminals[0].sendText.notCalled, 'nothing typed when integration is available');
		assert.ok(terminals[0].show.calledOnce, 'terminal shown');
	});

	test('openMonitorTTY types the command when shell integration never activates', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { terminals } = stubMonitorTerminal({ withIntegration: false });

		await monitorService.openMonitorTTY('run'); // waits out the integration timeout

		assert.ok(terminals[0].sendText.calledOnce, 'command typed as the fallback');
		const line = String(terminals[0].sendText.firstCall.args[0]);
		assert.ok(line.startsWith('uv run --project'), `runner args lead the line: ${line}`);
		assert.ok(line.includes('monitor -p COM5 -b 1000000'), `full command line: ${line}`);
	});

	test('openMonitorTTY honors the monitor flag settings', async () => {
		await setCfg('monitor.crlf', false);
		await setCfg('monitor.raw', false);
		await setCfg('monitor.echo', true);
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { executedOf } = stubMonitorTerminal();

		await monitorService.openMonitorTTY('run');

		assert.deepEqual(
			executedOf(0)[1].slice(-3),
			['--no-crlf', '--no-raw', '--echo'],
			'explicit off/on forms passed so bao.py defaults cannot win',
		);
	});

	test('openMonitorTTY passes a uv path containing spaces verbatim (A17 regression)', async () => {
		const spacedUv = 'C:\\Users\\Jean Doe\\AppData\\globalStorage\\uv\\uv.exe';
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { executedOf } = stubMonitorTerminal({ cmd: spacedUv });

		await monitorService.openMonitorTTY('run');

		// Shell integration owns the quoting: the executable must arrive raw, not pre-quoted.
		assert.equal(executedOf(0)[0], spacedUv, 'path reaches shell integration unmodified');
		assert.ok(!executedOf(0)[0].includes('"'), 'no quoting applied by the extension');
	});

	test('openMonitorTTY offers a repick when the saved port is absent and uses the new pick', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { create, executedOf, present, repick } = stubMonitorTerminal();
		present.resolves(false);
		repick.resolves('COM9');

		await monitorService.openMonitorTTY('run');

		assert.ok(repick.calledOnceWith('run', 'COM5'), 'repick offered for the absent port');
		assert.ok(create.calledOnce, 'monitor still opens after the repick');
		assert.ok(executedOf(0)[1].includes('COM9'), 'monitor uses the freshly picked port');
	});

	test('openMonitorTTY opens no terminal when the absent-port offer is declined', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { create, present } = stubMonitorTerminal();
		present.resolves(false);

		await monitorService.openMonitorTTY('run');

		assert.ok(create.notCalled, 'no dead monitor at an absent port');
	});

	test('openMonitorTTY proceeds normally when presence cannot be determined', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { create, executedOf, present, repick } = stubMonitorTerminal();
		present.resolves(null); // listing failed: unknown, not absent

		await monitorService.openMonitorTTY('run');

		assert.ok(repick.notCalled, 'no repick nag on an enumeration failure');
		assert.ok(create.calledOnce, 'monitor opens; it will surface the real error itself');
		assert.ok(executedOf(0)[1].includes('COM5'), 'original port used');
	});

	test('openMonitorTTY opens the terminal at the project root with the contained uv env', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { optionsOf } = stubMonitorTerminal();

		await monitorService.openMonitorTTY('run');

		assert.equal(optionsOf(0).env?.BAO_TEST_ENV, 'sentinel', 'uvEnv() reaches the terminal');
		assert.equal(
			optionsOf(0).cwd,
			vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
			'the prompt the user lands on after Ctrl+C is the project root, not extension storage',
		);
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
