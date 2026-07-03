import { log } from '@services/logService';
import { toMessage } from '@util/error';
import * as vscode from 'vscode';

/** Register a command, funneling any uncaught error into a single logged error toast. */
export function withCommand(
	id: string,
	handler: (...args: unknown[]) => unknown,
): vscode.Disposable {
	return vscode.commands.registerCommand(id, async (...args: unknown[]) => {
		try {
			await handler(...args);
		} catch (e) {
			const msg = toMessage(e);
			log(`command "${id}" failed: ${msg}`);
			vscode.window.showErrorMessage(vscode.l10n.t('Baochip: command failed.\n{0}', msg));
		}
	});
}
