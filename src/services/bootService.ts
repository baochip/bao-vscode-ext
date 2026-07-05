import { resolveBaoPy } from '@services/baoRunnerService';
import { getDefaultBaud } from '@services/configService';
import { errorToast, getChannel } from '@services/logService';
import { ensureSerialPort } from '@services/portsService';
import { describeRunFailure, runProcess } from '@services/procService';
import { getBaoRunner, getGlobalVenvRoot, uvEnv } from '@services/uvService';
import * as vscode from 'vscode';

function getBootChannel(): vscode.OutputChannel {
	return getChannel(vscode.l10n.t('Bao Boot'));
}

export async function sendBoot(): Promise<boolean> {
	const bao = resolveBaoPy();
	const root = getGlobalVenvRoot();
	// Ensure bootloader port is set; if not, prompt and re-check.
	const port = await ensureSerialPort('bootloader');
	if (!port) {
		vscode.window.showWarningMessage(
			vscode.l10n.t('Bootloader mode serial port is still not set. Aborting boot.'),
		);
		return false;
	}

	const baud = getDefaultBaud();
	const chan = getBootChannel();
	chan.show(true);
	chan.appendLine(`[bao] ${vscode.l10n.t("Sending 'boot' to {0} @ {1}...", port, baud)}`);

	const { cmd, args } = await getBaoRunner(); // e.g., uv + ['run','python']
	const fullArgs = [...args, bao, 'boot', '-p', port, '-b', String(baud)];

	const r = await runProcess(cmd, fullArgs, {
		cwd: root,
		env: uvEnv(),
		onStdout: (s) => chan.append(s),
		onStderr: (s) => chan.append(s),
	});
	if (!r.error && r.code === 0) {
		chan.appendLine(`[bao] ${vscode.l10n.t('boot command succeeded.')}`);
		return true;
	}
	const msg = describeRunFailure(r).slice(0, 300);
	errorToast(vscode.l10n.t('Boot command failed: {0}', msg)); // toast + central Baochip log
	chan.appendLine(`[bao] ${vscode.l10n.t('Boot command failed: {0}', msg)}`);
	return false;
}
