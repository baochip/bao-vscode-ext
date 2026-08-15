import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { runBaoCmd } from '@services/baoRunnerService';
import { openMonitorTTY } from '@services/monitorService';
import { runBuildFlashBoot } from '@services/pipelineService';
import { ensureSerialPort, offerRepickMissingPort, waitForPort } from '@services/portsService';
import * as vscode from 'vscode';

export function registerBuildFlashMonitor() {
	return withCommand(Commands.buildFlashMonitor, async () => {
		// 1) Build, 2) flash, 2.5) boot
		const booted = await runBuildFlashBoot();
		if (!booted) return;

		// Ensure run-mode port is set; if not, prompt and re-check.
		const runPort = await ensureSerialPort('run');
		if (!runPort) {
			vscode.window.showWarningMessage(
				vscode.l10n.t('Run mode serial port is still not set. Aborting monitor.'),
			);
			return;
		}

		// 3) Monitor (wait for run port to appear)
		const portResult = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t('Baochip: waiting for {0}...', runPort),
				cancellable: true,
			},
			async (progress, token) => {
				// small grace period so the bootloader can drop cleanly
				await new Promise((r) => setTimeout(r, 500));

				progress.report({ message: vscode.l10n.t('Waiting for run mode serial port...') });
				const result = await waitForPort(runBaoCmd, runPort, {
					timeoutMs: 20000,
					intervalMs: 500,
					token,
				});
				return token.isCancellationRequested ? 'cancelled' : result;
			},
		);

		// A probe error means bao.py is broken (waitForPort already toasted the reason);
		// opening the monitor would just fail again, so stop here.
		if (portResult === 'cancelled' || portResult === 'error') return;

		// The saved port may be a wrong-mode port that can never appear; opening a monitor at a
		// port that is not there just spawns a dead terminal (plus VS Code's own misleading
		// "terminal exited" toast), so offer to fix the port here instead.
		if (portResult === 'timeout') {
			const repicked = await offerRepickMissingPort('run', runPort);
			if (!repicked) return;
		}

		// Brief stability delay - let the UART settle before the monitor connects
		await new Promise((r) => setTimeout(r, 300));
		await openMonitorTTY('run');
	});
}
