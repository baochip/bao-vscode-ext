import {
	getBootloaderSerialPort,
	getDefaultBaud,
	getMonitorDefaultPort,
	getRunSerialPort,
} from '@services/configService';
import { ensureXousCorePath, getBaoRunner, resolveBaoPy } from '@services/pathService';
import * as vscode from 'vscode';

let monitorTerm: vscode.Terminal | undefined;

function q(s: string) {
	return /\s|["`]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

export async function openMonitorTTY(_context?: vscode.ExtensionContext) {
	// 1) Choose based on default
	const def = getMonitorDefaultPort(); // "run" | "bootloader"
	const port = def === 'run' ? getRunSerialPort() : getBootloaderSerialPort();

	if (!port) {
		const friendly = def === 'run' ? vscode.l10n.t('run mode') : vscode.l10n.t('bootloader mode');
		vscode.window.showInformationMessage(
			vscode.l10n.t('No {0} serial port set. Pick one first.', friendly),
		);
		await vscode.commands.executeCommand(
			def === 'run' ? 'baochip.setRunSerialPort' : 'baochip.setBootloaderSerialPort',
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
	const label = def === 'run' ? vscode.l10n.t('Run') : vscode.l10n.t('Bootloader');
	const termName = vscode.l10n.t('Bao Monitor ({0}: {1})', label, port);
	monitorTerm = vscode.window.createTerminal({ name: termName, cwd: root });
	monitorTerm.sendText(full);
	monitorTerm.show();
}

export function stopMonitorTTY() {
	try {
		monitorTerm?.dispose();
	} catch {}
	monitorTerm = undefined;
}

export async function openMonitorTTYOnMode(mode: 'run' | 'bootloader') {
	const port = mode === 'run' ? getRunSerialPort() : getBootloaderSerialPort();
	if (!port) {
		const friendly = mode === 'run' ? vscode.l10n.t('run mode') : vscode.l10n.t('bootloader mode');
		vscode.window.showInformationMessage(
			vscode.l10n.t('No {0} serial port set. Pick one first.', friendly),
		);
		await vscode.commands.executeCommand(
			mode === 'run' ? 'baochip.setRunSerialPort' : 'baochip.setBootloaderSerialPort',
		);
		return;
	}

	// Resolve paths
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

	const cfg = vscode.workspace.getConfiguration('baochip.monitor');
	const baud = getDefaultBaud();
	const flags: string[] = [];
	if (cfg.get<boolean>('crlf')) flags.push('--crlf');
	if (cfg.get<boolean>('raw')) flags.push('--raw');
	if (!cfg.get<boolean>('echo')) flags.push('--no-echo');

	const { cmd, args } = await getBaoRunner();
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

	try {
		monitorTerm?.dispose();
	} catch {}
	const label = mode === 'run' ? vscode.l10n.t('Run') : vscode.l10n.t('Bootloader');
	const termName = vscode.l10n.t('Bao Monitor ({0}: {1})', label, port);
	monitorTerm = vscode.window.createTerminal({ name: termName, cwd: root });
	monitorTerm.sendText(full);
	monitorTerm.show();
}
