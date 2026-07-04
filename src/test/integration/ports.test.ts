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
import { activateExtension, resetBaochipConfig, useSandbox } from './helpers';

const cfg = () => vscode.workspace.getConfiguration('baochip');
const setCfg = (key: string, value: unknown) =>
	cfg().update(key, value, vscode.ConfigurationTarget.Workspace);

const PORTS_OUTPUT = 'COM3\tUSB Serial Device\nCOM7\tBaochip DaBao';

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
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'OK',
		);
		sandbox.stub(baoRunnerService, 'runBaoCmd').resolves(PORTS_OUTPUT);
		const pick = sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub;
		pick.resolves({ label: 'COM7' });

		const port = await portsService.promptAndSaveSerialPort('run');

		assert.equal(port, 'COM7');
		assert.equal(cfg().get<string>('serialPortRun'), 'COM7');
		assert.equal(cfg().get<string>('serialPortBootloader') || '', '', 'bootloader key untouched');
		const items = pick.firstCall.args[0] as { label: string; description?: string }[];
		assert.deepEqual(
			items.map((i) => i.label),
			['COM3', 'COM7'],
		);
		assert.equal(items[0].description, 'USB Serial Device', 'description from the second column');
	});

	test('promptAndSaveSerialPort saves the picked bootloader port under the bootloader key', async () => {
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'OK',
		);
		sandbox.stub(baoRunnerService, 'runBaoCmd').resolves(PORTS_OUTPUT);
		(sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub).resolves({
			label: 'COM3',
		});

		const port = await portsService.promptAndSaveSerialPort('bootloader');

		assert.equal(port, 'COM3');
		assert.equal(cfg().get<string>('serialPortBootloader'), 'COM3');
		assert.equal(cfg().get<string>('serialPortRun') || '', '', 'run key untouched');
	});

	test('promptAndSaveSerialPort: cancelling the mode confirmation lists no ports', async () => {
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			undefined,
		);
		const runBao = sandbox.stub(baoRunnerService, 'runBaoCmd');

		const port = await portsService.promptAndSaveSerialPort('run');

		assert.equal(port, undefined);
		assert.ok(runBao.notCalled, 'ports never listed after cancel');
	});

	test('promptAndSaveSerialPort warns when no serial ports are found', async () => {
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'OK',
		);
		sandbox.stub(baoRunnerService, 'runBaoCmd').resolves('');
		const warnings = sandbox.stub(
			vscode.window,
			'showWarningMessage',
		) as unknown as sinon.SinonStub;

		const port = await portsService.promptAndSaveSerialPort('run');

		assert.equal(port, undefined);
		assert.ok(
			warnings.getCalls().some((c) => String(c.args[0]).includes('No serial ports found')),
			'no-ports warning shown',
		);
	});

	test('promptAndSaveSerialPort surfaces a ports-listing failure', async () => {
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'OK',
		);
		sandbox.stub(baoRunnerService, 'runBaoCmd').rejects(new Error('bao.py exploded'));
		sandbox.stub(vscode.window, 'showWarningMessage');
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const port = await portsService.promptAndSaveSerialPort('run');

		assert.equal(port, undefined);
		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('Could not list ports')),
			'listing-failure error shown',
		);
	});

	/* ------------------------------ ensureSerialPort ------------------------------ */

	test('ensureSerialPort returns a configured port without prompting', async () => {
		await setCfg('serialPortRun', 'COM9');
		const pick = sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub;

		const port = await portsService.ensureSerialPort('run');

		assert.equal(port, 'COM9');
		assert.ok(pick.notCalled, 'no picker for a configured port');
	});

	test('ensureSerialPort prompts when unset and returns the freshly saved port', async () => {
		(sandbox.stub(vscode.window, 'showInformationMessage') as unknown as sinon.SinonStub).resolves(
			'OK',
		);
		sandbox.stub(baoRunnerService, 'runBaoCmd').resolves(PORTS_OUTPUT);
		(sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub).resolves({
			label: 'COM7',
		});

		const port = await portsService.ensureSerialPort('run');

		assert.equal(port, 'COM7', 'continues in the same run with the fresh pick');
		assert.equal(cfg().get<string>('serialPortRun'), 'COM7');
	});

	/* ------------------------------ waitForPort ------------------------------ */

	test('waitForPort resolves true once the port shows up', async () => {
		let calls = 0;
		const runBao = async () => (++calls >= 3 ? 'COM7\tBaochip' : 'COM3\tOther');

		const seen = await portsService.waitForPort(runBao, 'COM7', {
			timeoutMs: 2000,
			intervalMs: 1,
		});

		assert.equal(seen, true);
		assert.equal(calls, 3);
	});

	test('waitForPort resolves false when the port never appears', async () => {
		const runBao = async () => 'COM3\tOther';

		const seen = await portsService.waitForPort(runBao, 'COM7', {
			timeoutMs: 30,
			intervalMs: 5,
		});

		assert.equal(seen, false);
	});

	test('waitForPort bails with one error toast after persistent listing failures', async () => {
		let calls = 0;
		const runBao = async (): Promise<string> => {
			calls++;
			throw new Error('bao.py broken');
		};
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const seen = await portsService.waitForPort(runBao, 'COM7', {
			timeoutMs: 5000,
			intervalMs: 1,
		});

		assert.equal(seen, false);
		assert.equal(calls, 3, 'bails after three consecutive failures, not the full timeout');
		assert.equal(errors.callCount, 1, 'exactly one error toast');
		assert.ok(String(errors.firstCall.args[0]).includes('Could not list ports'));
	});

	/* ------------------------------ openMonitorTTY ------------------------------ */

	function stubMonitorTerminal() {
		const sent: string[] = [];
		const term = {
			sendText: (t: string) => sent.push(t),
			show: () => {},
			dispose: () => {},
		};
		const create = sandbox
			.stub(vscode.window, 'createTerminal')
			.returns(term as unknown as vscode.Terminal);
		sandbox.stub(uvService, 'getBaoRunner').resolves({ cmd: 'uv', args: ['run', 'python'] });
		return { sent, create };
	}

	test('openMonitorTTY launches bao.py monitor with the port, baud, and default flags', async () => {
		const ensurePort = sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { sent, create } = stubMonitorTerminal();

		await monitorService.openMonitorTTY('run');

		assert.ok(ensurePort.calledOnceWith('run'));
		assert.ok(create.calledOnce, 'terminal created');
		assert.equal(sent.length, 1, 'one command sent');
		assert.ok(sent[0].startsWith('uv run python '), sent[0]);
		assert.ok(sent[0].includes(' monitor -p COM5 -b 1000000'), sent[0]);
		assert.ok(
			sent[0].includes('--crlf') && sent[0].includes('--raw') && sent[0].includes('--no-echo'),
			`default flags present: ${sent[0]}`,
		);
	});

	test('openMonitorTTY honors the monitor flag settings', async () => {
		await setCfg('monitor.crlf', false);
		await setCfg('monitor.raw', false);
		await setCfg('monitor.echo', true);
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM5');
		const { sent } = stubMonitorTerminal();

		await monitorService.openMonitorTTY('run');

		assert.ok(
			!sent[0].includes('--crlf') && !sent[0].includes('--raw') && !sent[0].includes('--no-echo'),
			`all flags omitted: ${sent[0]}`,
		);
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
		const { create } = stubMonitorTerminal();

		await monitorService.openMonitorTTY('run');

		assert.ok(create.notCalled, 'no terminal without a port');
	});

	/* ------------------------------ sendBoot ------------------------------ */

	test('sendBoot aborts with a warning when the bootloader port stays unset', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves(undefined);
		const { chan } = fakeChannel();
		sandbox.stub(logService, 'getChannel').returns(chan);
		const warnings = sandbox.stub(
			vscode.window,
			'showWarningMessage',
		) as unknown as sinon.SinonStub;

		const ok = await bootService.sendBoot();

		assert.equal(ok, false);
		assert.ok(
			warnings.getCalls().some((c) => String(c.args[0]).includes('Aborting boot')),
			'abort warning shown',
		);
	});

	test('sendBoot surfaces a failed boot command with its stderr', async () => {
		sandbox.stub(portsService, 'ensureSerialPort').resolves('COM7');
		sandbox.stub(uvService, 'getBaoRunner').resolves({ cmd: 'uv', args: ['run', 'python'] });
		sandbox
			.stub(procService, 'runProcess')
			.resolves({ code: 2, stdout: '', stderr: 'cannot open COM7', cancelled: false });
		const { lines, chan } = fakeChannel();
		sandbox.stub(logService, 'getChannel').returns(chan);
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
