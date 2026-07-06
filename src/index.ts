import { registerBuildCommand } from '@commands/build';
import { registerBuildFlashMonitor } from '@commands/buildFlashMonitor';
import { registerCleanCommand } from '@commands/clean';
import { Commands } from '@commands/commandIds';
import { registerCreateApp } from '@commands/createApp';
import { registerFlashCommand } from '@commands/flash';
import { registerOpenSettings } from '@commands/openSettings';
import { registerSelectApp } from '@commands/selectApp';
import { registerSelectBuildTarget } from '@commands/selectBuildTarget';
import { registerSetBootloaderSerialPort } from '@commands/setBootloaderSerialPort';
import { registerSetBuildMode } from '@commands/setBuildMode';
import { registerSetFlashLocation } from '@commands/setFlashLocation';
import { registerSetMonitorBaud } from '@commands/setMonitorBaud';
import { registerSetMonitorDefaultPort } from '@commands/setMonitorDefaultPort';
import { registerSetRunSerialPort } from '@commands/setRunSerialPort';
import { withCommand } from '@commands/withCommand';
import { openMonitorTTY, stopMonitorTTY } from '@services/monitorService';
import { rerunExtensionSetup, resetUvSetup } from '@services/uvService';
import { WelcomePanel } from '@webviews/welcome/welcomePanel';
import * as vscode from 'vscode';

export function registerCommands(context: vscode.ExtensionContext) {
	context.subscriptions.push(
		registerSetBuildMode(),
		registerSetBootloaderSerialPort(),
		registerSetRunSerialPort(),
		registerSetMonitorBaud(),
		registerSetMonitorDefaultPort(),
		withCommand(Commands.openMonitor, () => openMonitorTTY()),
		withCommand(Commands.stopMonitor, () => stopMonitorTTY()),
		registerSetFlashLocation(),
		registerSelectBuildTarget(),
		registerBuildCommand(),
		registerSelectApp(),
		registerCreateApp(),
		registerCleanCommand(),
		registerFlashCommand(),
		registerBuildFlashMonitor(),
		registerOpenSettings(),
		withCommand(Commands.openWelcome, () => WelcomePanel.show(context)),
		withCommand(Commands.resetUvSetup, () => resetUvSetup()),
		withCommand(Commands.rerunSetup, () => rerunExtensionSetup()),
	);
}
