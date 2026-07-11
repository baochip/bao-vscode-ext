import * as vscode from 'vscode';

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
