import { registerBuildCommand } from '@commands/build';
import { registerBuildFlashMonitor } from '@commands/buildFlashMonitor';
import { registerCleanCommand } from '@commands/clean';
import { registerCreateApp } from '@commands/createApp';
import { registerFlashCommand } from '@commands/flash';
import { registerSelectApp } from '@commands/selectApp';
import { registerSetMonitorBaud } from '@commands/setMonitorBaud';
import { registerSetMonitorDefaultPort } from '@commands/setMonitorDefaultPort';
import { withCommand } from '@commands/withCommand';
import { openMonitorTTY, stopMonitorTTY } from '@services/monitorService';
import { WelcomePanel } from '@webviews/welcome/welcomePanel';
import * as vscode from 'vscode';
import { registerSelectBuildTarget } from './commands/selectBuildTarget';
import { registerSetBootloaderSerialPort } from './commands/setBootloaderSerialPort';
import { registerSetBuildMode } from './commands/setBuildMode';
import { registerSetFlashLocation } from './commands/setFlashLocation';
import { registerSetRunSerialPort } from './commands/setRunSerialPort';

export function registerCommands(context: vscode.ExtensionContext, refreshUI: () => void) {
	context.subscriptions.push(
		registerSetBuildMode(context, refreshUI),
		registerSetBootloaderSerialPort(context, refreshUI),
		registerSetRunSerialPort(context, refreshUI),
		registerSetMonitorBaud(context),
		registerSetMonitorDefaultPort(context, refreshUI),
		withCommand('baochip.openMonitor', () => openMonitorTTY()),
		withCommand('baochip.stopMonitor', () => stopMonitorTTY()),
		registerSetFlashLocation(context, refreshUI),
		registerSelectBuildTarget(context, refreshUI),
		registerBuildCommand(context),
		registerSelectApp(context),
		registerCreateApp(context),
		registerCleanCommand(context),
		registerFlashCommand(context),
		registerBuildFlashMonitor(context),
		withCommand('baochip.openSettings', async () => {
			await vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'Baochip');
		}),
		withCommand('baochip.openWelcome', () => WelcomePanel.show(context)),
	);
}
