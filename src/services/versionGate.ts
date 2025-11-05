import * as vscode from 'vscode';
import { checkToolsBaoVersion } from '@services/versionService';

export function gateToolsBao(
  commandId: string,
  handler: (...args: any[]) => any
): vscode.Disposable {
  return vscode.commands.registerCommand(commandId, async (...args: any[]) => {
    const ok = await checkToolsBaoVersion();
    if (!ok) return;
    return handler(...args);
  });
}
