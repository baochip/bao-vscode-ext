import * as vscode from 'vscode';
import { registerSetMonitorPort } from './setMonitorPort';
import { registerOpenMonitor } from './openMonitor';
import { registerSetFlashPort } from './setFlashPort';

export function registerCommands(context: vscode.ExtensionContext, refreshUI: () => void) {
  context.subscriptions.push(
    registerSetMonitorPort(context, refreshUI),
    registerOpenMonitor(context),
    registerSetFlashPort(context, refreshUI)
  );
}
