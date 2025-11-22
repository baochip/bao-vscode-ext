import { ensureXousCorePath } from '@services/pathService';
import * as vscode from 'vscode';

function ensureTerminal(name: string): vscode.Terminal {
	return (
		vscode.window.terminals.find((t) => t.name === name) ?? vscode.window.createTerminal({ name })
	);
}

export function registerCleanCommand(_context: vscode.ExtensionContext) {
	return vscode.commands.registerCommand('baochip.clean', async () => {
		let root: string;
		try {
			root = await ensureXousCorePath(); // prompts if not set
		} catch (e: unknown) {
			const message = e instanceof Error ? e.message : String(e);
			vscode.window.showErrorMessage(message || vscode.l10n.t('xous-core path not set'));
			return;
		}

		const term = ensureTerminal(vscode.l10n.t('Bao Clean'));
		term.sendText(`cd "${root}"`);
		term.sendText('cargo clean');
		term.show(true);
	});
}
