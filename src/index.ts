import { registerBuildCommand } from '@commands/build';
import { registerBuildFlashMonitor } from '@commands/buildFlashMonitor';
import { registerCleanCommand } from '@commands/clean';
import { Commands } from '@commands/commandIds';
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
		registerSetBuildMode(refreshUI),
		registerSetBootloaderSerialPort(refreshUI),
		registerSetRunSerialPort(refreshUI),
		registerSetMonitorBaud(),
		registerSetMonitorDefaultPort(refreshUI),
		withCommand(Commands.openMonitor, () => openMonitorTTY()),
		withCommand(Commands.stopMonitor, () => stopMonitorTTY()),
		registerSetFlashLocation(refreshUI),
		registerSelectBuildTarget(refreshUI),
		registerBuildCommand(),
		registerSelectApp(),
		registerCreateApp(),
		registerCleanCommand(),
		registerFlashCommand(),
		registerBuildFlashMonitor(),
		withCommand(Commands.openSettings, async () => {
			await vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'Baochip');
		}),
		withCommand(Commands.openWelcome, () => WelcomePanel.show(context)),
	);
}
