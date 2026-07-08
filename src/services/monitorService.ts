import { buildBaoArgs, ensureBaoDepsQuietly, resolveBaoPy } from '@services/baoRunnerService';
import { getDefaultBaud, getMonitorDefaultPort, getMonitorFlags } from '@services/configService';
import { ensureSerialPort } from '@services/portsService';
import { getBaoRunner, getGlobalVenvRoot, uvEnv } from '@services/uvService';
import * as vscode from 'vscode';

let monitorTerm: vscode.Terminal | undefined;
let monitorTermListener: vscode.Disposable | undefined;

/**
 * Interrupt (Ctrl+C, no trailing newline so bao.py closes the serial port cleanly) and tear down
 * the monitor terminal and its close listener. Safe to call when nothing is open.
 */
function closeMonitorTerminal(): void {
	try {
		monitorTerm?.sendText('\x03', false);
		monitorTerm?.dispose();
	} catch {}
	monitorTerm = undefined;
	monitorTermListener?.dispose(); // otherwise the onDidCloseTerminal handler leaks
	monitorTermListener = undefined;
}

/**
 * Open the serial monitor terminal.
 * If `mode` is omitted, the default port preference from settings is used.
 */
export async function openMonitorTTY(mode?: 'run' | 'bootloader'): Promise<void> {
	// 1) Choose port based on mode (or default preference)
	const resolvedMode = mode ?? getMonitorDefaultPort();
	const port = await ensureSerialPort(resolvedMode);
	if (!port) return;

	// 2) Settings -> flags (do not localize CLI flags). Always pass the explicit on/off form:
	// omitting a flag would fall back to bao.py's PuTTY-style defaults, not the user's setting.
	const { crlf, raw, echo } = getMonitorFlags();
	const baud = getDefaultBaud();
	const flags: string[] = [
		crlf ? '--crlf' : '--no-crlf',
		raw ? '--raw' : '--no-raw',
		echo ? '--echo' : '--no-echo',
	];

	// The terminal runs bao.py directly (not via runBaoCmd), so the venv and its deps must be
	// prepared here or a fresh install hits ModuleNotFoundError inside the terminal.
	await ensureBaoDepsQuietly();

	const { cmd, args } = await getBaoRunner(); // uv + ['run','python']
	const shellArgs = buildBaoArgs(args, resolveBaoPy(), 'monitor', port, baud, flags);

	// 3) Launch terminal - it runs uv directly (shellPath/shellArgs), so no shell ever parses the
	// command line: spaces in the uv path are safe regardless of the user's default shell
	// (a PowerShell line starting with a quoted path is an expression, not an invocation).
	closeMonitorTerminal();
	const label = resolvedMode === 'run' ? vscode.l10n.t('Run') : vscode.l10n.t('Bootloader');
	const termName = vscode.l10n.t('Baochip Monitor ({0}: {1})', label, port);
	monitorTerm = vscode.window.createTerminal({
		name: termName,
		cwd: getGlobalVenvRoot(),
		shellPath: cmd,
		shellArgs,
		env: uvEnv(),
	});
	monitorTermListener = vscode.window.onDidCloseTerminal((t) => {
		if (t === monitorTerm) {
			monitorTerm = undefined;
			monitorTermListener?.dispose();
			monitorTermListener = undefined;
		}
	});
	monitorTerm.show();
}

export function stopMonitorTTY() {
	closeMonitorTerminal();
}
