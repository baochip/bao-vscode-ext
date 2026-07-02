import {
	getBootloaderSerialPort,
	getDefaultBaud,
	getMonitorDefaultPort,
	getMonitorFlags,
	getRunSerialPort,
} from '@services/configService';
import { resolveBaoPy } from '@services/pathService';
import { getBaoRunner, getGlobalVenvRoot } from '@services/uvService';
import { quoteArg } from '@util/shell';
import * as vscode from 'vscode';

let monitorTerm: vscode.Terminal | undefined;
let monitorTermListener: vscode.Disposable | undefined;

/**
 * Open the serial monitor terminal.
 * If `mode` is omitted, the default port preference from settings is used.
 */
export async function openMonitorTTY(mode?: 'run' | 'bootloader'): Promise<void> {
	// 1) Choose port based on mode (or default preference)
	const resolvedMode = mode ?? getMonitorDefaultPort();
	const port = resolvedMode === 'run' ? getRunSerialPort() : getBootloaderSerialPort();

	if (!port) {
		const friendly =
			resolvedMode === 'run' ? vscode.l10n.t('run mode') : vscode.l10n.t('bootloader mode');
		vscode.window.showInformationMessage(
			vscode.l10n.t('No {0} serial port set. Pick one first.', friendly),
		);
		await vscode.commands.executeCommand(
			resolvedMode === 'run' ? 'baochip.setRunSerialPort' : 'baochip.setBootloaderSerialPort',
		);
		return;
	}

	// 2) Settings -> flags (do not localize CLI flags)
	const { crlf, raw, echo } = getMonitorFlags();
	const baud = getDefaultBaud();
	const flags: string[] = [];
	if (crlf) flags.push('--crlf');
	if (raw) flags.push('--raw');
	if (!echo) flags.push('--no-echo');

	const { cmd, args } = await getBaoRunner(); // uv + ['run','python']
	const full = [
		quoteArg(cmd),
		...args.map(quoteArg),
		quoteArg(resolveBaoPy()),
		'monitor',
		'-p',
		quoteArg(port),
		'-b',
		String(baud),
		...flags,
	].join(' ');

	// 3) Launch terminal
	try {
		monitorTerm?.sendText('\x03'); // Ctrl+C — let bao.py close the serial port cleanly
		monitorTerm?.dispose();
	} catch {}
	monitorTermListener?.dispose();
	const label = resolvedMode === 'run' ? vscode.l10n.t('Run') : vscode.l10n.t('Bootloader');
	const termName = vscode.l10n.t('Bao Monitor ({0}: {1})', label, port);
	monitorTerm = vscode.window.createTerminal({ name: termName, cwd: getGlobalVenvRoot() });
	monitorTermListener = vscode.window.onDidCloseTerminal((t) => {
		if (t === monitorTerm) {
			monitorTerm = undefined;
			monitorTermListener?.dispose();
			monitorTermListener = undefined;
		}
	});
	monitorTerm.sendText(full);
	monitorTerm.show();
}

export function stopMonitorTTY() {
	try {
		monitorTerm?.sendText('\x03'); // Ctrl+C — let bao.py close the serial port cleanly
		monitorTerm?.dispose();
	} catch {}
	monitorTerm = undefined;
}
