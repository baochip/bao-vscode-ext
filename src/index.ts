import { registerBuildCommand } from '@commands/build';
import { registerBuildFlashMonitor } from '@commands/buildFlashMonitor';
import { registerCleanCommand } from '@commands/clean';
import { registerCreateApp } from '@commands/createApp';
import { registerFlashCommand } from '@commands/flash';
import { registerOpenSettings } from '@commands/openSettings';
import { registerSelectApp } from '@commands/selectApp';
import { registerSetMonitorDefaultPort } from '@commands/setMonitorDefaultPort';
import { WelcomePanel } from '@webviews/welcome/welcomePanel';
import * as vscode from 'vscode';
import { registerOpenMonitor } from './commands/openMonitor';
import { registerSelectBuildTarget } from './commands/selectBuildTarget';
import { registerSetBootloaderSerialPort } from './commands/setBootloaderSerialPort';
import { registerSetFlashLocation } from './commands/setFlashLocation';
import { registerSetRunSerialPort } from './commands/setRunSerialPort';

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
