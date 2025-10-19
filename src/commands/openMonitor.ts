import * as vscode from 'vscode';
import { openMonitor } from '@services/monitorService';

export function registerOpenMonitor(context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand('baochip.openMonitor', () => openMonitor(context));
}
