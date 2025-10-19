import * as vscode from 'vscode';
import { WelcomePanel } from '@webviews/welcome/welcomePanel';
import { registerSetMonitorPort } from './commands/setMonitorPort';
import { registerOpenMonitor } from './commands/openMonitor';
import { registerSetFlashLocation } from './commands/setFlashLocation';
import { registerSelectBuildTarget } from './commands/selectBuildTarget';
import { registerBuildCommand } from '@commands/build';
import { registerSelectApp } from '@commands/selectApp';
import { registerCreateApp } from '@commands/createApp';
import { registerCleanCommand } from '@commands/clean';
import { registerFlashCommand } from '@commands/flash';
import { registerFlashForceAll } from '@commands/flashForceAll';
import { registerBuildFlashMonitor } from '@commands/buildFlashMonitor';

export function registerCommands(context: vscode.ExtensionContext, refreshUI: () => void) {
  context.subscriptions.push(
    registerSetMonitorPort(context, refreshUI),
    registerOpenMonitor(context),
    registerSetFlashLocation(context, refreshUI),
    registerSelectBuildTarget(context, refreshUI),
    registerBuildCommand(context),
    registerSelectApp(context),
    registerCreateApp(context),
    registerCleanCommand(context),
    registerFlashCommand(context),
    registerFlashForceAll(context),
    registerBuildFlashMonitor(context),
    vscode.commands.registerCommand('baochip.openWelcome', () => WelcomePanel.show(context)),
  );
}
