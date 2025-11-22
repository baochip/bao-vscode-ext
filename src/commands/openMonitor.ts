import {
	getBootloaderSerialPort,
	getDefaultBaud,
	getMonitorDefaultPort,
	getRunSerialPort,
} from '@services/configService';
import { ensureXousCorePath, getBaoRunner, resolveBaoPy } from '@services/pathService';
import { gateToolsBao } from '@services/versionGate';
import * as vscode from 'vscode';

let monitorTerm: vscode.Terminal | undefined;
const q = (s: string) => (/\s|["`]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

export function registerOpenMonitor(_context: vscode.ExtensionContext) {
	return gateToolsBao('baochip.openMonitor', async () => {
		// 1) Choose which port based on default
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
			vscode.window.showWarningMessage(message || vscode.l10n.t('xous-core / bao.py not set'));
			return;
		}

		const baud = getDefaultBaud();

		// 3) Read monitor flags
		const cfg = vscode.workspace.getConfiguration('baochip.monitor');
		const useCrlf = cfg.get<boolean>('crlf', true);
		const useRaw = cfg.get<boolean>('raw', false);
		const useEcho = cfg.get<boolean>('echo', false);

		const flags: string[] = [];
		if (useCrlf) flags.push('--crlf');
		if (useRaw) flags.push('--raw');
		if (!useEcho) flags.push('--no-echo');

		// 4) Launch terminal via uv
		try {
			monitorTerm?.dispose();
		} catch {}
		const label = def === 'run' ? vscode.l10n.t('Run') : vscode.l10n.t('Bootloader');
		const termName = vscode.l10n.t('Bao Monitor ({0}: {1})', label, port);
		monitorTerm = vscode.window.createTerminal({ name: termName, cwd: root });

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
		]
			.join(' ')
			.trim();

		monitorTerm.sendText(full);
		monitorTerm.show();
	});
}
