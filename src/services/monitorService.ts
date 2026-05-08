import {
	getBootloaderSerialPort,
	getDefaultBaud,
	getMonitorDefaultPort,
	getRunSerialPort,
} from '@services/configService';
import { ensureXousCorePath, resolveBaoPy } from '@services/pathService';
import { getBaoRunner } from '@services/uvService';
import * as vscode from 'vscode';

let monitorTerm: vscode.Terminal | undefined;
let monitorTermListener: vscode.Disposable | undefined;

function q(s: string) {
	return /\s|["`]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

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

	// 2) Resolve paths
	let root: string;
	let bao: string;
	try {
		root = await ensureXousCorePath();
		bao = await resolveBaoPy();
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		vscode.window.showWarningMessage(message ?? vscode.l10n.t('xous-core / bao.py not set'));
		return;
	}

	// 3) Settings -> flags (do not localize CLI flags)
	const cfg = vscode.workspace.getConfiguration('baochip.monitor');
	const baud = getDefaultBaud();
	const flags: string[] = [];
	if (cfg.get<boolean>('crlf')) flags.push('--crlf');
	if (cfg.get<boolean>('raw')) flags.push('--raw');
	if (!cfg.get<boolean>('echo')) flags.push('--no-echo');

	const { cmd, args } = await getBaoRunner(); // uv + ['run','python']
	const full = [
		q(cmd),
		...args.map(q),
		q(bao),
		'monitor',
		'-p',
		q(port),
		'-b',
		String(baud),
		...flags,
	].join(' ');

	// 4) Launch terminal
	try {
		monitorTerm?.dispose();
	} catch {}
	monitorTermListener?.dispose();
	const label = resolvedMode === 'run' ? vscode.l10n.t('Run') : vscode.l10n.t('Bootloader');
	const termName = vscode.l10n.t('Bao Monitor ({0}: {1})', label, port);
	monitorTerm = vscode.window.createTerminal({ name: termName, cwd: root });
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
		monitorTerm?.dispose();
	} catch {}
	monitorTerm = undefined;
}
