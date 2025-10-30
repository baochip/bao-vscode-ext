import * as vscode from 'vscode';
import { WelcomePanel } from '@webviews/welcome/welcomePanel';
import { registerSetBootloaderSerialPort } from './commands/setBootloaderSerialPort';
import { registerSetRunSerialPort } from './commands/setRunSerialPort';
import { registerOpenMonitor } from './commands/openMonitor';
import { registerSetFlashLocation } from './commands/setFlashLocation';
import { registerSelectBuildTarget } from './commands/selectBuildTarget';
import { registerBuildCommand } from '@commands/build';
import { registerSelectApp } from '@commands/selectApp';
import { registerCreateApp } from '@commands/createApp';
import { registerCleanCommand } from '@commands/clean';
import { registerFlashCommand } from '@commands/flash';
import { registerBuildFlashMonitor } from '@commands/buildFlashMonitor';
import { registerOpenSettings } from '@commands/openSettings';
import { registerSetMonitorDefaultPort } from '@commands/setMonitorDefaultPort';
  
export function registerCommands(context: vscode.ExtensionContext, refreshUI: () => void) {
  context.subscriptions.push(
    registerSetBootloaderSerialPort(context, refreshUI),
    registerSetRunSerialPort(context, refreshUI),
    registerSetMonitorDefaultPort(context, refreshUI),
    registerOpenMonitor(context),
    registerSetFlashLocation(context, refreshUI),
    registerSelectBuildTarget(context, refreshUI),
    registerBuildCommand(context),
    registerSelectApp(context),
    registerCreateApp(context),
    registerCleanCommand(context),
    registerFlashCommand(context),
    registerBuildFlashMonitor(context),
    registerOpenSettings(context),
    vscode.commands.registerCommand('baochip.openWelcome', () => WelcomePanel.show(context)),
  );
}
