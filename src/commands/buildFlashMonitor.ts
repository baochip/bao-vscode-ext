import * as path from 'node:path';
import { sendBoot } from '@services/bootService';
import {
	ensureBuildPrereqs,
	runBuildAndWait,
	runOutOfTreeBuildAndWait,
} from '@services/buildService';
import { getRunSerialPort } from '@services/configService';
import { decideAndFlash } from '@services/flashService';
import {
	ensureKernelModeConfigured,
	fetchLatestXousCoreRev,
	resolveKernelFiles,
} from '@services/kernelService';
import { openMonitorTTY } from '@services/monitorService';
import { runBaoCmd } from '@services/pathService';
import { waitForPort } from '@services/portsService';
import { convertElfToUf2 } from '@services/uf2ConvertService';
import * as vscode from 'vscode';

export function registerBuildFlashMonitor(_context: vscode.ExtensionContext) {
	return vscode.commands.registerCommand('baochip.buildFlashMonitor', async () => {
		// Gather/validate build prereqs (root/target/app)
		const pre = await ensureBuildPrereqs();
		if (!pre) return;

		// PO-6a: kernel mode setup + optional Cargo.toml rev sync (out-of-tree only)
		if (pre.mode === 'out-of-tree') {
			const kernelMode = await ensureKernelModeConfigured();
			if (!kernelMode) return;

			if (kernelMode === 'ci-sync') {
				let rev: string;
				try {
					rev = await fetchLatestXousCoreRev();
				} catch (e: unknown) {
					const message = e instanceof Error ? e.message : String(e);
					vscode.window.showErrorMessage(
						vscode.l10n.t('Failed to fetch latest xous-core rev: {0}', message),
					);
					return;
				}
				try {
					await runBaoCmd([
						'app',
						'update-rev',
						'--file',
						path.join(pre.root, 'Cargo.toml'),
						'--rev',
						rev,
					]);
				} catch (e: unknown) {
					const message = e instanceof Error ? e.message : String(e);
					vscode.window.showErrorMessage(
						vscode.l10n.t('Failed to update xous-core rev in Cargo.toml: {0}', message),
					);
					return;
				}
			}
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

		// PO-6b: resolve kernel files (out-of-tree only)
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
		let runPort = getRunSerialPort();
		if (!runPort) {
			vscode.window.showInformationMessage(
				vscode.l10n.t('No run mode serial port set. Pick one first.'),
			);
			await vscode.commands.executeCommand('baochip.setRunSerialPort');

			// Re-check after the command returns.
			runPort = getRunSerialPort();
			if (!runPort) {
				vscode.window.showWarningMessage(
					vscode.l10n.t('Run mode serial port is still not set. Aborting monitor.'),
				);
				return;
			}
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
				await openMonitorTTY('run');
			},
		);
	});
}
