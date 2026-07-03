import { withCommand } from '@commands/withCommand';
import { sendBoot } from '@services/bootService';
import {
	ensureBuildPrereqs,
	runBuildAndWait,
	runOutOfTreeBuildAndWait,
} from '@services/buildService';
import { decideAndFlash } from '@services/flashService';
import { ensureOutOfTreeBuildSetup, resolveKernelFiles } from '@services/kernelService';
import { openMonitorTTY } from '@services/monitorService';
import { runBaoCmd } from '@services/pathService';
import { ensureSerialPort, waitForPort } from '@services/portsService';
import { convertElfToUf2 } from '@services/uf2ConvertService';
import * as vscode from 'vscode';

export function registerBuildFlashMonitor(_context: vscode.ExtensionContext) {
	return withCommand('baochip.buildFlashMonitor', async () => {
		// Gather/validate build prereqs (root/target/app)
		const pre = await ensureBuildPrereqs();
		if (!pre) return;

		if (pre.mode === 'out-of-tree') {
			const ok = await ensureOutOfTreeBuildSetup(pre.root);
			if (!ok) return;
		}

		// 1) Build
		const code =
			pre.mode === 'out-of-tree'
				? await runOutOfTreeBuildAndWait(pre.root)
				: await runBuildAndWait(pre.root, pre.target, pre.app);
		if (code !== 0) {
			vscode.window.showErrorMessage(vscode.l10n.t('Build failed.'));
			return;
		}

		// 1.5) ELF→UF2 conversion (out-of-tree only)
		if (pre.mode === 'out-of-tree') {
			const converted = await convertElfToUf2(pre.root);
			if (!converted) return;
		}

		// Resolve kernel files for flashing (out-of-tree only)
		let kernelFiles: { loader: string; xous: string } | null = null;
		if (pre.mode === 'out-of-tree') {
			kernelFiles = await resolveKernelFiles();
			if (!kernelFiles) return;
		}

		// 2) Flash
		const flashed = await decideAndFlash(pre.root, kernelFiles ?? undefined);
		if (!flashed) return;

		// 2.5) Tell device to exit bootloader and run firmware
		const ok = await sendBoot();
		if (!ok) return;

		// Ensure run-mode port is set; if not, prompt and re-check.
		const runPort = await ensureSerialPort('run');
		if (!runPort) {
			vscode.window.showWarningMessage(
				vscode.l10n.t('Run mode serial port is still not set. Aborting monitor.'),
			);
			return;
		}

		// 3) Monitor (wait for run port to appear)
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t('Baochip: waiting for {0}…', runPort),
				cancellable: true,
			},
			async (progress, token) => {
				// small grace period so the bootloader can drop cleanly
				await new Promise((r) => setTimeout(r, 500));

				progress.report({ message: vscode.l10n.t('Waiting for run mode serial port…') });
				const seen = await waitForPort(runBaoCmd, runPort, {
					timeoutMs: 20000,
					intervalMs: 500,
					token,
				});

				if (token.isCancellationRequested) return;

				if (!seen) {
					vscode.window.showWarningMessage(
						vscode.l10n.t('Run mode port {0} didn’t appear in time. Trying anyway…', runPort),
					);
				}

				// Brief stability delay — let the UART settle before the monitor connects
				await new Promise((r) => setTimeout(r, 300));
				if (token.isCancellationRequested) return;
				await openMonitorTTY('run');
			},
		);
	});
}
