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

// The pipeline stubbed at its module seams, defaulted to the xous-core happy path. The monitor
// and port seams are stubbed too, so a test can assert this command never reaches them.
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

/** Every stage that belongs only to the monitor pipeline stayed untouched. */
function assertNoMonitorTail(p: ReturnType<typeof stubPipeline>) {
	assert.ok(p.monitor.notCalled, 'no monitor opened');
	assert.ok(p.ensurePort.notCalled, 'run port never prompted for');
	assert.ok(p.waitPort.notCalled, 'no port wait');
}

async function runPipeline(): Promise<void> {
	await vscode.commands.executeCommand(Commands.buildFlashBoot);
}

suite('Build-Flash-Boot pipeline', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	test('xous-core happy path runs build, flash, boot in order and stops', async () => {
		const p = stubPipeline(sandbox);

		await runPipeline();

		assert.ok(p.build.calledOnceWith(XOUS_ROOT, 'dabao', 'hello'), 'build with root/target/app');
		assert.ok(p.flash.calledOnce, 'flash called');
		assert.deepEqual(
			p.flash.firstCall.args,
			[XOUS_ROOT, { mode: 'xous-core' }],
			'flash without kernel files',
		);
		assert.ok(p.boot.calledOnce, 'boot called');
		assert.ok(p.build.calledBefore(p.flash), 'build before flash');
		assert.ok(p.flash.calledBefore(p.boot), 'flash before boot');
		assertNoMonitorTail(p);
		// xous-core mode must not touch the out-of-tree stages
		assert.ok(p.kernelSetup.notCalled && p.convert.notCalled && p.kernelFiles.notCalled);
		assert.ok(p.errors.notCalled, 'no error toasts on the happy path');
		assert.ok(p.warnings.notCalled, 'no warnings on the happy path');
	});

	test('missing prereqs stop the pipeline before build', async () => {
		const p = stubPipeline(sandbox);
		p.prereqs.resolves(undefined);

		await runPipeline();

		assert.ok(p.build.notCalled && p.buildOot.notCalled, 'no build');
		assert.ok(p.flash.notCalled && p.boot.notCalled, 'nothing downstream');
		assertNoMonitorTail(p);
	});

	test('a cancelled build stops the pipeline quietly, with no failure toast', async () => {
		const p = stubPipeline(sandbox);
		p.build.resolves(null); // null = user cancelled

		await runPipeline();

		assert.ok(!toastIncludes(p.errors, 'Build failed.'), 'no failure toast for a cancel');
		assert.ok(p.flash.notCalled && p.boot.notCalled, 'nothing downstream');
	});

	test('a failing build stops before flash with a "Build failed." toast', async () => {
		const p = stubPipeline(sandbox);
		p.build.resolves(1);

		await runPipeline();

		assert.ok(toastIncludes(p.errors, 'Build failed.'), 'build-failed toast shown');
		assert.ok(p.flash.notCalled && p.boot.notCalled, 'nothing downstream');
	});

	test('a failed flash stops before boot', async () => {
		const p = stubPipeline(sandbox);
		p.flash.resolves(false);

		await runPipeline();

		assert.ok(p.boot.notCalled, 'no boot after a failed flash');
		assertNoMonitorTail(p);
	});

	test('a failed boot ends the command without a monitor', async () => {
		const p = stubPipeline(sandbox);
		p.boot.resolves(false);

		await runPipeline();

		assert.ok(p.boot.calledOnce, 'boot attempted');
		assertNoMonitorTail(p);
	});

	test('out-of-tree happy path adds kernel setup, UF2 convert, and kernel files to flash', async () => {
		const p = stubPipeline(sandbox);
		p.prereqs.resolves({ mode: 'out-of-tree', root: OOT_ROOT, crates: ['hello'] });

		await runPipeline();

		assert.ok(p.kernelSetup.calledOnceWith(OOT_ROOT), 'kernel setup ran');
		assert.ok(p.buildOot.calledOnceWith(OOT_ROOT), 'out-of-tree build ran');
		assert.ok(p.build.notCalled, 'xtask build not used');
		assert.ok(p.convert.calledOnceWith(OOT_ROOT), 'ELF to UF2 conversion ran');
		assert.deepEqual(
			p.flash.firstCall.args,
			[OOT_ROOT, { mode: 'out-of-tree', kernelFiles: KERNEL_FILES }],
			'flash with kernel files',
		);
		assert.ok(p.boot.calledOnce, 'boot called');
		assertNoMonitorTail(p);
	});

	test('out-of-tree: a failed UF2 conversion stops before flash', async () => {
		const p = stubPipeline(sandbox);
		p.prereqs.resolves({ mode: 'out-of-tree', root: OOT_ROOT, crates: ['hello'] });
		p.convert.resolves(false);

		await runPipeline();

		assert.ok(p.kernelFiles.notCalled, 'kernel files never resolved');
		assert.ok(p.flash.notCalled && p.boot.notCalled, 'nothing downstream');
	});

	test('out-of-tree: a failed kernel setup stops before build', async () => {
		const p = stubPipeline(sandbox);
		p.prereqs.resolves({ mode: 'out-of-tree', root: OOT_ROOT, crates: ['hello'] });
		p.kernelSetup.resolves(false);

		await runPipeline();

		assert.ok(p.buildOot.notCalled && p.convert.notCalled, 'no build or conversion');
		assert.ok(p.flash.notCalled && p.boot.notCalled, 'nothing downstream');
	});
});
