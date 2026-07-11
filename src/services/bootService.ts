import { buildBaoArgs, ensureBaoDepsQuietly, resolveBaoPy } from '@services/baoRunnerService';
import { getDefaultBaud } from '@services/configService';
import { appendSeparator, errorToast, getBaochipChannel } from '@services/logService';
import { ensureSerialPort } from '@services/portsService';
import { describeRunFailure, runProcess } from '@services/procService';
import { getBaoRunner, getGlobalVenvRoot, uvEnv } from '@services/uvService';
import * as vscode from 'vscode';

export async function sendBoot(): Promise<boolean> {
	const bao = resolveBaoPy();
	const root = getGlobalVenvRoot();
	// Ensure bootloader port is set; if not, prompt and re-check.
	const port = await ensureSerialPort('bootloader');
	// Silent abort (like the monitor): ensureSerialPort already surfaces a listing failure, and a
	// cancelled pick needs no extra nag - this also avoids an error+warning double-notification.
	if (!port) return false;

	const baud = getDefaultBaud();
	const chan = getBaochipChannel();
	appendSeparator(chan, 'Boot');
	chan.show(true);
	chan.appendLine(`[bao] ${vscode.l10n.t("Sending 'boot' to {0} @ {1}...", port, baud)}`);

	// Boot runs bao.py directly (not via runBaoCmd), so the venv and its deps must be
	// prepared here or a fresh install hits ModuleNotFoundError.
	await ensureBaoDepsQuietly();

	const { cmd, args } = await getBaoRunner(); // e.g., uv + ['run','python']
	const fullArgs = buildBaoArgs(args, bao, 'boot', port, baud);

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
