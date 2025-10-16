import * as vscode from 'vscode';
import { registerSetMonitorPort } from './setMonitorPort';
import { registerOpenMonitor } from './openMonitor';
import { registerSetFlashPort } from './setFlashPort';
import { registerSelectBuildTarget } from './selectBuildTarget';
import { registerSetFlashMethod } from '@commands/setFlashMethod';

export function registerCommands(context: vscode.ExtensionContext, refreshUI: () => void) {
  context.subscriptions.push(
    registerSetMonitorPort(context, refreshUI),
    registerOpenMonitor(context),
    registerSetFlashPort(context, refreshUI),
    registerSelectBuildTarget(context, refreshUI),
    registerSetFlashMethod(context, refreshUI)
  );
}
