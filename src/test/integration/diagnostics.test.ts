import * as assert from 'node:assert';
import { Commands } from '@commands/commandIds';
import * as baoRunnerService from '@services/baoRunnerService';
import * as diagnosticsService from '@services/diagnosticsService';
import * as logService from '@services/logService';
import * as procService from '@services/procService';
import * as toolkitService from '@services/toolkitService';
import * as uvService from '@services/uvService';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import { activateExtension, fakeChannel, resetBaochipConfig, useSandbox } from './helpers';

suite('Diagnostics command', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	teardown(async () => {
		await resetBaochipConfig();
	});

	function stubProbes() {
		sandbox
			.stub(uvService, 'getBaoRunner')
			.resolves({ cmd: 'C:\\fake\\uv.exe', args: ['run', 'python'] });
		sandbox.stub(uvService, 'uvEnv').returns({});
		sandbox.stub(baoRunnerService, 'runBaoCmd').resolves('COM7\tBaochip Dabao');
		sandbox.stub(toolkitService, 'isXousToolkitInstalled').resolves(true);
		const run = sandbox
			.stub(procService, 'runProcess')
			.resolves({ code: 0, stdout: 'tool 1.0.0', stderr: '', cancelled: false });
		// The rustup probe must see the OFFICIAL bare-metal triple; the custom Xous triple never
		// appears in rustup's list (that one is the toolkit probe's job).
		run.withArgs('rustup').resolves({
			code: 0,
			stdout: 'riscv32imac-unknown-none-elf\nwasm32-unknown-unknown',
			stderr: '',
			cancelled: false,
		});
		const { lines, chan } = fakeChannel();
		sandbox.stub(logService, 'getBaochipChannel').returns(chan);
		const info = sandbox.stub(
			vscode.window,
			'showInformationMessage',
		) as unknown as sinon.SinonStub;
		info.resolves(undefined);
		const clip = sandbox.stub(diagnosticsService, 'copyToClipboard').resolves();
		const open = sandbox.stub(vscode.env, 'openExternal').resolves(true);
		return { run, lines, info, clip, open };
	}

	test('collects a report into the channel with header facts and probe lines', async () => {
		const { lines } = stubProbes();

		await vscode.commands.executeCommand(Commands.collectDiagnostics);

		const text = lines.join('\n');
		assert.ok(text.includes('===== Diagnostics ====='), 'separator present');
		assert.ok(text.includes(`VS Code ${vscode.version}`), 'editor version in the header');
		assert.ok(text.includes('Mode:'), 'mode line present');
		assert.ok(text.includes('Settings: run='), 'settings snapshot present');
		assert.ok(
			text.includes('[ok]   serial ports (bao.py): 1 found: COM7 (Baochip Dabao)'),
			`ports probed: ${text}`,
		);
		assert.ok(text.includes('[ok]   rustc: tool 1.0.0'), 'rustc probed');
		assert.ok(
			text.includes('[ok]   riscv target (rustup): installed'),
			`rustup probed for the OFFICIAL triple, not the custom Xous one: ${text}`,
		);
		assert.ok(
			text.includes('[ok]   xous target (sysroot): riscv32imac-unknown-xous-elf installed'),
			'the xous-elf target is verified by name via the sysroot',
		);
		assert.ok(text.includes('workspace: 1 folder'), 'folder COUNT reported, never folder names');
	});

	test('a failing probe renders FAIL without killing the rest of the report', async () => {
		const { run, lines } = stubProbes();
		run.withArgs('rustc').resolves({
			code: null,
			stdout: '',
			stderr: '',
			cancelled: false,
			error: new Error('spawn rustc ENOENT'),
		});

		await vscode.commands.executeCommand(Commands.collectDiagnostics);

		const text = lines.join('\n');
		assert.ok(text.includes('[FAIL] rustc: spawn rustc ENOENT'), `rustc failure surfaced: ${text}`);
		assert.ok(text.includes('[ok]   cargo: tool 1.0.0'), 'later probes still ran');
	});

	test('the Copy to Clipboard button writes the report and re-offers the issue button', async () => {
		const { info, clip, open } = stubProbes();
		info.onFirstCall().resolves('Copy to Clipboard');
		info.onSecondCall().resolves(undefined); // follow-up toast dismissed

		await vscode.commands.executeCommand(Commands.collectDiagnostics);

		assert.ok(clip.calledOnce, 'report copied');
		assert.ok(String(clip.firstCall.args[0]).includes('Mode:'), 'the report itself is copied');
		assert.ok(
			info.secondCall.args.includes('Open GitHub Issue'),
			'the issue button is re-offered after the copy toast dismissed itself',
		);
		assert.ok(open.notCalled, 'no browser opened when the follow-up is dismissed');
	});

	test('copy followed by the re-offered issue button opens the chooser without re-copying', async () => {
		const { info, clip, open } = stubProbes();
		info.onFirstCall().resolves('Copy to Clipboard');
		info.onSecondCall().resolves('Open GitHub Issue');

		await vscode.commands.executeCommand(Commands.collectDiagnostics);

		assert.ok(clip.calledOnce, 'copied exactly once');
		assert.ok(open.calledOnce, 'issue chooser opened from the follow-up toast');
	});

	test('the Open GitHub Issue button opens the chooser WITHOUT copying, then offers the copy', async () => {
		const { info, clip, open } = stubProbes();
		info.onFirstCall().resolves('Open GitHub Issue');
		info.onSecondCall().resolves(undefined); // copy offer declined

		await vscode.commands.executeCommand(Commands.collectDiagnostics);

		assert.ok(open.calledOnce, 'issue page opened');
		assert.ok(
			String(open.firstCall.args[0]).includes('/issues/new/choose'),
			'the chooser, so non-bug reporters are not railroaded into the bug form',
		);
		assert.ok(clip.notCalled, 'the clipboard is the customer decision, never automatic');
		assert.ok(
			info.secondCall.args.includes('Copy to Clipboard'),
			'the copy is offered after opening',
		);
	});

	test('accepting the copy offer after opening an issue writes the report', async () => {
		const { info, clip } = stubProbes();
		info.onFirstCall().resolves('Open GitHub Issue');
		info.onSecondCall().resolves('Copy to Clipboard');

		await vscode.commands.executeCommand(Commands.collectDiagnostics);

		assert.ok(clip.calledOnce, 'copied only on request');
		assert.ok(String(clip.firstCall.args[0]).includes('Mode:'), 'the report itself is copied');
	});

	test("the welcome page's 'report-issue' origin opens the chooser and offers (not does) the copy", async () => {
		const { info, clip, open } = stubProbes();

		await vscode.commands.executeCommand(Commands.collectDiagnostics, 'report-issue');

		assert.ok(open.calledOnce, 'issue chooser opened');
		assert.ok(clip.notCalled, 'nothing copied without the user choosing to');
		assert.ok(
			!info.getCalls().some((c) => String(c.args[0]).includes('Diagnostics collected')),
			'no intermediate question in the one-click flow',
		);
		assert.ok(
			info.getCalls().some((c) => String(c.args[0]).includes('Add the diagnostics report')),
			'the copy offer is shown instead',
		);
	});
});
