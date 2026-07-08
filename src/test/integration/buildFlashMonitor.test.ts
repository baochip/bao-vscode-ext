import * as assert from 'node:assert';
import { Commands } from '@commands/commandIds';
import * as bootService from '@services/bootService';
import * as buildService from '@services/buildService';
import * as flashService from '@services/flashService';
import * as kernelService from '@services/kernelService';
import * as monitorService from '@services/monitorService';
import * as portsService from '@services/portsService';
import * as uf2ConvertService from '@services/uf2ConvertService';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import { activateExtension, useSandbox } from './helpers';

const XOUS_ROOT = 'C:\\fake\\xous-core';
const OOT_ROOT = 'C:\\fake\\oot-app';
const KERNEL_FILES = { loader: 'C:\\fake\\kernel\\loader.uf2', xous: 'C:\\fake\\kernel\\xous.uf2' };

// The whole pipeline stubbed at its module seams, defaulted to the xous-core happy path.
// Each test overrides one stage to assert the short-circuit behavior.
function stubPipeline(sandbox: sinon.SinonSandbox) {
	return {
		prereqs: sandbox.stub(buildService, 'ensureBuildPrereqs').resolves({
			mode: 'xous-core',
			root: XOUS_ROOT,
			target: 'dabao',
			app: 'hello',
		}),
		build: sandbox.stub(buildService, 'runBuildAndWait').resolves(0),
		buildOot: sandbox.stub(buildService, 'runOutOfTreeBuildAndWait').resolves(0),
		kernelSetup: sandbox.stub(kernelService, 'ensureOutOfTreeBuildSetup').resolves(true),
		kernelFiles: sandbox.stub(kernelService, 'resolveKernelFiles').resolves(KERNEL_FILES),
		convert: sandbox.stub(uf2ConvertService, 'convertElfToUf2').resolves(true),
		flash: sandbox.stub(flashService, 'decideAndFlash').resolves(true),
		boot: sandbox.stub(bootService, 'sendBoot').resolves(true),
		ensurePort: sandbox.stub(portsService, 'ensureSerialPort').resolves('COM7'),
		waitPort: sandbox.stub(portsService, 'waitForPort').resolves('found'),
		monitor: sandbox.stub(monitorService, 'openMonitorTTY').resolves(),
		errors: sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub,
		warnings: sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub,
	};
}

function toastIncludes(toastStub: sinon.SinonStub, text: string): boolean {
	return toastStub.getCalls().some((c) => String(c.args[0]).includes(text));
}

// The pipeline's grace/stability delays run under sinon fake timers, so advance the clock through
// them instead of sleeping ~0.8s of real wall-clock per monitor-reaching test.
async function runPipeline(clock: sinon.SinonFakeTimers): Promise<void> {
	const p = vscode.commands.executeCommand(Commands.buildFlashMonitor);
	await clock.runAllAsync();
	await p;
}

suite('Build-Flash-Monitor pipeline', () => {
	const sandbox = useSandbox();
	let clock: sinon.SinonFakeTimers;

	suiteSetup(async () => {
		await activateExtension();
	});

	setup(() => {
		// Fake only setTimeout so the pipeline's grace/stability delays cost no real wall-clock.
		// shouldClearNativeTimers: a background extension (json-language-features) clears its own
		// native timers on file events while these fakes are installed; without this, fake-timers
		// throws on the foreign id and the stray error lands in an unrelated afterEach hook.
		clock = sandbox.useFakeTimers({
			toFake: ['setTimeout', 'clearTimeout'],
			shouldClearNativeTimers: true,
		});
	});

	test('xous-core happy path runs build, flash, boot, port wait, monitor in order', async () => {
		const p = stubPipeline(sandbox);

		await runPipeline(clock);

		assert.ok(p.build.calledOnceWith(XOUS_ROOT, 'dabao', 'hello'), 'build with root/target/app');
		assert.ok(p.flash.calledOnce, 'flash called');
		assert.deepEqual(p.flash.firstCall.args, [XOUS_ROOT, undefined], 'flash without kernel files');
		assert.ok(p.boot.calledOnce, 'boot called');
		assert.ok(p.monitor.calledOnceWith('run'), 'monitor opened in run mode');
		assert.ok(p.build.calledBefore(p.flash), 'build before flash');
		assert.ok(p.flash.calledBefore(p.boot), 'flash before boot');
		assert.ok(p.boot.calledBefore(p.monitor), 'boot before monitor');
		// xous-core mode must not touch the out-of-tree stages
		assert.ok(p.kernelSetup.notCalled && p.convert.notCalled && p.kernelFiles.notCalled);
		assert.ok(p.errors.notCalled, 'no error toasts on the happy path');
	});

	test('missing prereqs stop the pipeline before build', async () => {
		const p = stubPipeline(sandbox);
		p.prereqs.resolves(undefined);

		await runPipeline(clock);

		assert.ok(p.build.notCalled && p.buildOot.notCalled, 'no build');
		assert.ok(p.flash.notCalled && p.boot.notCalled && p.monitor.notCalled, 'nothing downstream');
	});

	test('a cancelled build stops the pipeline quietly, with no failure toast', async () => {
		const p = stubPipeline(sandbox);
		p.build.resolves(null); // null = user cancelled

		await runPipeline(clock);

		assert.ok(!toastIncludes(p.errors, 'Build failed.'), 'no failure toast for a cancel');
		assert.ok(p.flash.notCalled && p.boot.notCalled && p.monitor.notCalled, 'nothing downstream');
	});

	test('a failing build stops before flash with a "Build failed." toast', async () => {
		const p = stubPipeline(sandbox);
		p.build.resolves(1);

		await runPipeline(clock);

		assert.ok(toastIncludes(p.errors, 'Build failed.'), 'build-failed toast shown');
		assert.ok(p.flash.notCalled && p.boot.notCalled && p.monitor.notCalled, 'nothing downstream');
	});

	test('a failed flash stops before boot', async () => {
		const p = stubPipeline(sandbox);
		p.flash.resolves(false);

		await runPipeline(clock);

		assert.ok(p.boot.notCalled && p.monitor.notCalled, 'no boot or monitor after failed flash');
	});

	test('a failed boot stops before the port wait and monitor', async () => {
		const p = stubPipeline(sandbox);
		p.boot.resolves(false);

		await runPipeline(clock);

		assert.ok(p.ensurePort.notCalled, 'run port never checked');
		assert.ok(p.waitPort.notCalled && p.monitor.notCalled, 'no port wait or monitor');
	});

	test('an unset run port aborts the monitor with a warning', async () => {
		const p = stubPipeline(sandbox);
		p.ensurePort.resolves(undefined);

		await runPipeline(clock);

		assert.ok(toastIncludes(p.warnings, 'Aborting monitor.'), 'abort warning shown');
		assert.ok(p.waitPort.notCalled && p.monitor.notCalled, 'no port wait or monitor');
	});

	test('a port that times out warns but still opens the monitor', async () => {
		const p = stubPipeline(sandbox);
		p.waitPort.resolves('timeout');

		await runPipeline(clock);

		assert.ok(toastIncludes(p.warnings, "didn't appear in time"), 'timeout warning shown');
		assert.ok(p.monitor.calledOnceWith('run'), 'monitor still opened');
	});

	test('a port-probe error stops before the monitor with no bogus timeout warning', async () => {
		const p = stubPipeline(sandbox);
		p.waitPort.resolves('error'); // bao.py broken; waitForPort already toasted the reason

		await runPipeline(clock);

		assert.ok(
			!toastIncludes(p.warnings, "didn't appear in time"),
			'no "trying anyway" warning when the probe itself failed',
		);
		assert.ok(p.monitor.notCalled, 'no doomed monitor opened after a probe error');
	});

	test('out-of-tree happy path adds kernel setup, UF2 convert, and kernel files to flash', async () => {
		const p = stubPipeline(sandbox);
		p.prereqs.resolves({ mode: 'out-of-tree', root: OOT_ROOT });

		await runPipeline(clock);

		assert.ok(p.kernelSetup.calledOnceWith(OOT_ROOT), 'kernel setup ran');
		assert.ok(p.buildOot.calledOnceWith(OOT_ROOT), 'out-of-tree build ran');
		assert.ok(p.build.notCalled, 'xtask build not used');
		assert.ok(p.convert.calledOnceWith(OOT_ROOT), 'ELF to UF2 conversion ran');
		assert.deepEqual(p.flash.firstCall.args, [OOT_ROOT, KERNEL_FILES], 'flash with kernel files');
		assert.ok(p.monitor.calledOnceWith('run'), 'monitor opened');
	});

	test('out-of-tree: a failed UF2 conversion stops before flash', async () => {
		const p = stubPipeline(sandbox);
		p.prereqs.resolves({ mode: 'out-of-tree', root: OOT_ROOT });
		p.convert.resolves(false);

		await runPipeline(clock);

		assert.ok(p.kernelFiles.notCalled, 'kernel files never resolved');
		assert.ok(p.flash.notCalled && p.boot.notCalled && p.monitor.notCalled, 'nothing downstream');
	});
});
