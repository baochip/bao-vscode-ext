import * as vscode from 'vscode';

const SHELL_INTEGRATION_TIMEOUT_MS = 2000;

// The shell-integration API is newer than the pinned @types/vscode, so it is reached through
// these minimal structural types plus a runtime guard; when the API is absent, callers take
// the typed-command fallback.
export interface ShellIntegration {
	executeCommand(executable: string, args?: string[]): unknown;
}
type IntegrationChange = { terminal: vscode.Terminal; shellIntegration: ShellIntegration };
type IntegrationWindow = {
	onDidChangeTerminalShellIntegration?: (
		listener: (e: IntegrationChange) => void,
	) => vscode.Disposable;
};

/**
 * Return the existing terminal named `name`, or create a new one. When creating, `cwd` sets the
 * working directory via the VS Code API (not a typed `cd`), so paths with non-ASCII characters work
 * regardless of the terminal's console code page. A reused terminal keeps its current directory.
 */
export function ensureNamedTerminal(name: string, cwd?: string): vscode.Terminal {
	return (
		vscode.window.terminals.find((t) => t.name === name) ??
		vscode.window.createTerminal({ name, cwd })
	);
}

/**
 * Resolve the terminal's shell integration once it activates, or undefined on timeout
 * (cmd has no shell integration, and users can disable it).
 */
export function waitForShellIntegration(
	term: vscode.Terminal,
): Promise<ShellIntegration | undefined> {
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
 * Run a command line in `term`, waiting for shell integration first. A freshly created terminal
 * may still be running an environment activation (a Python venv, say), and text sent into that
 * interrupts it - which shows up as the build dying with STATUS_CONTROL_C_EXIT.
 */
export async function runInTerminal(term: vscode.Terminal, commandLine: string): Promise<void> {
	const si = await waitForShellIntegration(term);
	if (si) si.executeCommand(commandLine);
	else term.sendText(commandLine);
}
