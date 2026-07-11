import { buildBaoArgs, ensureBaoDepsQuietly, resolveBaoPy } from '@services/baoRunnerService';
import { getDefaultBaud, getMonitorDefaultPort, getMonitorFlags } from '@services/configService';
import { ensureSerialPort, isPortPresent, offerRepickMissingPort } from '@services/portsService';
import { getBaoRunner, getGlobalVenvRoot, uvEnv } from '@services/uvService';
import { quoteArg } from '@util/shell';
import * as vscode from 'vscode';

// How long to wait for the terminal's shell integration before falling back to a typed command.
// Integration normally activates well under a second; cmd never activates it at all.
const SHELL_INTEGRATION_TIMEOUT_MS = 2000;

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

// The shell-integration API is newer than the pinned @types/vscode, so it is reached through
// these minimal structural types plus a runtime guard; when the API is absent the monitor
// simply takes the typed-command fallback.
interface ShellIntegration {
	executeCommand(executable: string, args: string[]): unknown;
}
type IntegrationChange = { terminal: vscode.Terminal; shellIntegration: ShellIntegration };
type IntegrationWindow = {
	onDidChangeTerminalShellIntegration?: (
		listener: (e: IntegrationChange) => void,
	) => vscode.Disposable;
};

/**
 * Resolve the terminal's shell integration once it activates, or undefined on timeout
 * (cmd has no shell integration, and users can disable it).
 */
function waitForShellIntegration(term: vscode.Terminal): Promise<ShellIntegration | undefined> {
	const existing = (term as vscode.Terminal & { shellIntegration?: ShellIntegration })
		.shellIntegration;
	if (existing) return Promise.resolve(existing);
	const onDidChange = (vscode.window as IntegrationWindow).onDidChangeTerminalShellIntegration;
	if (!onDidChange) return Promise.resolve(undefined);
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			listener.dispose();
			resolve(undefined);
		}, SHELL_INTEGRATION_TIMEOUT_MS);
		const listener = onDidChange((e) => {
			if (e.terminal === term) {
				clearTimeout(timer);
				listener.dispose();
				resolve(e.shellIntegration);
			}
		});
	});
}

/**
 * Open the serial monitor in a regular shell terminal: Ctrl+C ends bao.py and returns the user
 * to their prompt with the output still above. If `mode` is omitted, the default port
 * preference from settings is used.
 */
export async function openMonitorTTY(mode?: 'run' | 'bootloader'): Promise<void> {
	// 1) Choose port based on mode (or default preference)
	const resolvedMode = mode ?? getMonitorDefaultPort();
	let port = await ensureSerialPort(resolvedMode);
	if (!port) return;

	// A saved port that is not currently enumerated (board unplugged, or the port was saved in
	// the other mode) would just spawn a monitor that dies immediately - offer to fix the port
	// instead. An enumeration failure (null) proceeds; the monitor itself will surface the
	// real error.
	if ((await isPortPresent(port)) === false) {
		port = await offerRepickMissingPort(resolvedMode, port);
		if (!port) return;
	}

	// 2) Settings -> flags (do not localize CLI flags). Always pass the explicit on/off form:
	// omitting a flag would fall back to bao.py's PuTTY-style defaults, not the user's setting.
	const { crlf, raw, echo } = getMonitorFlags();
	const baud = getDefaultBaud();
	const flags: string[] = [
		crlf ? '--crlf' : '--no-crlf',
		raw ? '--raw' : '--no-raw',
		echo ? '--echo' : '--no-echo',
	];

	// The monitor runs bao.py directly (not via runBaoCmd), so the venv and its deps must be
	// prepared here or a fresh install hits ModuleNotFoundError inside the terminal.
	await ensureBaoDepsQuietly();

	const { cmd, args } = await getBaoRunner(); // uv + ['run','python']
	// uv finds the venv via --project instead of cwd, so the terminal itself can live in the
	// user's project root - after Ctrl+C the prompt should land somewhere useful, not in the
	// extension's storage directory.
	const venvRoot = getGlobalVenvRoot();
	const runnerArgs = [args[0], '--project', venvRoot, ...args.slice(1)];
	const monitorArgs = buildBaoArgs(runnerArgs, resolveBaoPy(), 'monitor', port, baud, flags);
	const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? venvRoot;

	// 3) Launch in the user's shell. Shell integration quotes the command correctly for
	// whatever shell is running (including PowerShell's leading-quoted-path quirk); without it
	// the command is typed with our own quoting, which is safe everywhere except PowerShell
	// with a spaced uv path AND integration disabled - a corner the integration path removes.
	closeMonitorTerminal();
	const label = resolvedMode === 'run' ? vscode.l10n.t('Run') : vscode.l10n.t('Bootloader');
	const termName = vscode.l10n.t('Baochip Monitor ({0}: {1})', label, port);
	const term = vscode.window.createTerminal({
		name: termName,
		cwd,
		env: uvEnv(),
	});
	monitorTerm = term;
	monitorTermListener = vscode.window.onDidCloseTerminal((t) => {
		if (t === term && monitorTerm === term) {
			monitorTerm = undefined;
			monitorTermListener?.dispose();
			monitorTermListener = undefined;
		}
	});
	term.show();

	const si = await waitForShellIntegration(term);
	if (monitorTerm !== term) return; // closed or replaced while waiting for integration
	if (si) {
		si.executeCommand(cmd, monitorArgs);
	} else {
		term.sendText([cmd, ...monitorArgs].map((a) => quoteArg(a)).join(' '));
	}
}

export function stopMonitorTTY() {
	closeMonitorTerminal();
}
