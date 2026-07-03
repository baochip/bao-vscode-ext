import * as vscode from 'vscode';

/** Return the existing terminal named `name`, or create a new one. */
export function ensureNamedTerminal(name: string): vscode.Terminal {
	return (
		vscode.window.terminals.find((t) => t.name === name) ?? vscode.window.createTerminal({ name })
	);
}
