import * as vscode from 'vscode';
import { WelcomePanel } from '@webviews/welcome/welcomePanel';
import { registerSetMonitorPort } from './commands/setMonitorPort';
import { registerOpenMonitor } from './commands/openMonitor';
import { registerSetFlashPort } from './commands/setFlashPort';
import { registerSelectBuildTarget } from './commands/selectBuildTarget';
import { registerSetFlashMethod } from '@commands/setFlashMethod';
import { registerBuildCommand } from '@commands/build';
import { registerSelectApp } from '@commands/selectApp';
import { registerCreateApp } from '@commands/createApp';

export function registerCommands(context: vscode.ExtensionContext, refreshUI: () => void) {
  context.subscriptions.push(
    registerSetMonitorPort(context, refreshUI),
    registerOpenMonitor(context),
    registerSetFlashPort(context, refreshUI),
    registerSelectBuildTarget(context, refreshUI),
    registerSetFlashMethod(context, refreshUI),
    registerBuildCommand(context),
    registerSelectApp(context),
    registerCreateApp(context),
    vscode.commands.registerCommand('baochip.openWelcome', () => WelcomePanel.show(context)),
  );
}
