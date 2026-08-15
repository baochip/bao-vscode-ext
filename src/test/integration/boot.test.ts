import * as assert from 'node:assert';
import { sendBoot } from '@services/bootService';
import * as portsService from '@services/portsService';
import * as procService from '@services/procService';
import * as uvService from '@services/uvService';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { activateExtension, useSandbox } from './helpers';

const BOOTLOADER_PORT = 'COM99';
const RUN_PORT = 'COM98';

async function setPorts(bootloader: string, run: string): Promise<void> {
	const cfg = vscode.workspace.getConfiguration('baochip');
	await cfg.update('serialPortBootloader', bootloader, vscode.ConfigurationTarget.Workspace);
	await cfg.update('serialPortRun', run, vscode.ConfigurationTarget.Workspace);
}

// bao.py is stubbed at the process seam, so these tests exercise the send/verify/retry loop
// rather than the serial layer.
function stubBoot(sandbox: sinon.SinonSandbox) {
	sandbox.stub(uvService, 'getBaoRunner').resolves({ cmd: 'uv', args: ['run', 'python'] });
	sandbox.stub(uvService, 'ensureBaoPythonDeps').resolves();
	return {
		run: sandbox
			.stub(procService, 'runProcess')
			.resolves({ code: 0, stdout: '', stderr: '', cancelled: false }),
		present: sandbox.stub(portsService, 'isPortPresent'),
		warnings: sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub,
		errors: sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub,
	};
}

/** Drive sendBoot through its retry waits on the fake clock instead of ~9s of wall-clock. */
async function runBoot(clock: sinon.SinonFakeTimers): Promise<boolean> {
	const p = sendBoot();
	await clock.tickAsync(30000);
	return p;
}

suite('Boot command send and verify', () => {
	const sandbox = useSandbox();
	let clock: sinon.SinonFakeTimers;

	suiteSetup(async () => {
		await activateExtension();
	});

	setup(async () => {
		await setPorts(BOOTLOADER_PORT, RUN_PORT);
		// Date is faked too: the port-drop wait measures elapsed time with Date.now, so a fake
		// setTimeout alone would leave it spinning forever.
		clock = sandbox.useFakeTimers({
			toFake: ['setTimeout', 'clearTimeout', 'Date'],
			shouldClearNativeTimers: true,
		});
	});

	test('a bootloader port that disappears is one send and no warning', async () => {
		const p = stubBoot(sandbox);
		p.present.resolves(false);

		const ok = await runBoot(clock);

		assert.equal(ok, true);
		assert.ok(p.run.calledOnce, 'boot sent exactly once');
		assert.ok(p.warnings.notCalled, 'no warning when the board restarted');
		const [, args] = p.run.firstCall.args;
		assert.ok(args.includes('boot') && args.includes(BOOTLOADER_PORT), args.join(' '));
	});

	test('a port that never disappears is retried three times, then warned about', async () => {
		const p = stubBoot(sandbox);
		p.present.resolves(true);

		const ok = await runBoot(clock);

		assert.equal(p.run.callCount, 3, 'three sends');
		assert.ok(
			p.warnings.getCalls().some((c) => String(c.args[0]).includes(BOOTLOADER_PORT)),
			'warning names the port that stayed',
		);
		assert.equal(ok, true, 'the command itself worked, so the pipeline is not failed');
	});

	test('a port that disappears on the second attempt stops there', async () => {
		const p = stubBoot(sandbox);
		// Present for every probe of the first attempt, gone once the second send has gone out.
		p.present.callsFake(async () => p.run.callCount < 2);

		const ok = await runBoot(clock);

		assert.equal(ok, true);
		assert.equal(p.run.callCount, 2, 'resent once, then confirmed');
		assert.ok(p.warnings.notCalled, 'no warning once it took');
	});

	test('an unreadable port list skips verification and sends once', async () => {
		const p = stubBoot(sandbox);
		p.present.resolves(null);

		const ok = await runBoot(clock);

		assert.equal(ok, true);
		assert.ok(p.run.calledOnce, 'no retry on an unverifiable result');
		assert.ok(p.warnings.notCalled, 'nothing to warn about');
	});

	test('one port name for both modes skips verification entirely', async () => {
		await setPorts(BOOTLOADER_PORT, BOOTLOADER_PORT);
		const p = stubBoot(sandbox);
		p.present.resolves(true);

		const ok = await runBoot(clock);

		assert.equal(ok, true);
		assert.ok(p.run.calledOnce, 'sent once');
		assert.ok(p.present.notCalled, 'presence says nothing when the ports share a name');
	});

	test('a failing boot command reports and does not retry', async () => {
		const p = stubBoot(sandbox);
		p.run.resolves({ code: 1, stdout: '', stderr: 'cannot open COM99', cancelled: false });
		p.present.resolves(true);

		const ok = await runBoot(clock);

		assert.equal(ok, false);
		assert.ok(p.run.calledOnce, 'a broken command is not worth resending');
		assert.ok(p.errors.called, 'the failure is surfaced');
	});
});
