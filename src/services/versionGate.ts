import { checkToolsBaoVersion } from '@services/versionService';
import * as vscode from 'vscode';

export function gateToolsBao(
	commandId: string,
	handler: (...args: unknown[]) => unknown,
): vscode.Disposable {
	return vscode.commands.registerCommand(commandId, async (...args: unknown[]) => {
		const ok = await checkToolsBaoVersion();
		if (!ok) return;
		return handler(...args);
	});
}
