import { getDefaultBaud } from '@services/configService';
import { resolveBaoPy } from '@services/pathService';
import { ensureSerialPort } from '@services/portsService';
import { runProcess } from '@services/procService';
import { getBaoRunner, getGlobalVenvRoot } from '@services/uvService';
import * as vscode from 'vscode';

let _bootChan: vscode.OutputChannel | undefined;
function getBootChannel(): vscode.OutputChannel {
	if (!_bootChan) _bootChan = vscode.window.createOutputChannel(vscode.l10n.t('Bao Boot'));
	return _bootChan;
}

export async function sendBoot(): Promise<boolean> {
	const bao = resolveBaoPy();
	const root = getGlobalVenvRoot();
	// Ensure bootloader port is set; if not, prompt and re-check.
	const port = await ensureSerialPort('bootloader');
	if (!port) {
		vscode.window.showWarningMessage(
			'Bootloader mode serial port is still not set. Aborting boot.',
		);
		return false;
	}

	const baud = getDefaultBaud();
	const chan = getBootChannel();
	chan.show(true);
	chan.appendLine(`[bao] ${vscode.l10n.t("Sending 'boot' to {0} @ {1}…", port, baud)}`);

	const { cmd, args } = await getBaoRunner(); // e.g., uv + ['run','python']
	const fullArgs = [...args, bao, 'boot', '-p', port, '-b', String(baud)];

	const r = await runProcess(cmd, fullArgs, {
		cwd: root,
		onStdout: (s) => chan.append(s),
		onStderr: (s) => chan.append(s),
	});
	if (!r.error && r.code === 0) {
		chan.appendLine(`[bao] ${vscode.l10n.t('boot command succeeded.')}`);
		return true;
	}
	const detail = r.error ? r.error.message : r.stderr || r.stdout || `exit ${r.code}`;
	const msg = detail.trim().slice(0, 300);
	vscode.window.showErrorMessage(vscode.l10n.t('Boot command failed: {0}', msg));
	chan.appendLine(`[bao] ${vscode.l10n.t('Boot command failed: {0}', msg)}`);
	return false;
}
