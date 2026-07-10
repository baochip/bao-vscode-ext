import { Commands } from '@commands/commandIds';
import * as vscode from 'vscode';

/** The extension's status bar items, keyed by what each one shows or triggers. */
export interface StatusBarItems {
	bootloaderSerialPort: vscode.StatusBarItem;
	runSerialPort: vscode.StatusBarItem;
	flashLocation: vscode.StatusBarItem;
	buildTarget: vscode.StatusBarItem;
	app: vscode.StatusBarItem;
	clean: vscode.StatusBarItem;
	build: vscode.StatusBarItem;
	flash: vscode.StatusBarItem;
	monitor: vscode.StatusBarItem;
	buildFlashMonitor: vscode.StatusBarItem;
	buildMode: vscode.StatusBarItem;
	settings: vscode.StatusBarItem;
}

/**
 * Create every Baochip status bar item (left side). Each item carries a stable localized
 * name so the status bar context menu and screen readers can identify it. Text, tooltip,
 * and visibility are painted by the caller's refresh.
 */
export function createStatusBarItems(context: vscode.ExtensionContext): StatusBarItems {
	// Higher priority number = appears more to the left
	function makeStatusItem(priority: number, command: string, name: string): vscode.StatusBarItem {
		const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
		item.command = command;
		item.name = name;
		context.subscriptions.push(item);
		return item;
	}

	return {
		bootloaderSerialPort: makeStatusItem(
			100,
			Commands.setBootloaderSerialPort,
			vscode.l10n.t('Baochip: Bootloader Mode Serial Port'),
		),
		runSerialPort: makeStatusItem(
			99,
			Commands.setRunSerialPort,
			vscode.l10n.t('Baochip: Run Mode Serial Port'),
		),
		flashLocation: makeStatusItem(
			98,
			Commands.setFlashLocation,
			vscode.l10n.t('Baochip: Flash Location'),
		),
		buildTarget: makeStatusItem(
			97,
			Commands.selectBuildTarget,
			vscode.l10n.t('Baochip: Build Target'),
		),
		app: makeStatusItem(96, Commands.selectApp, vscode.l10n.t('Baochip: App')),
		clean: makeStatusItem(95, Commands.clean, vscode.l10n.t('Baochip: Clean')),
		build: makeStatusItem(94, Commands.build, vscode.l10n.t('Baochip: Build')),
		flash: makeStatusItem(93, Commands.flash, vscode.l10n.t('Baochip: Flash')),
		monitor: makeStatusItem(92, Commands.openMonitor, vscode.l10n.t('Baochip: Monitor')),
		buildFlashMonitor: makeStatusItem(
			91,
			Commands.buildFlashMonitor,
			vscode.l10n.t('Baochip: Build - Flash - Monitor'),
		),
		buildMode: makeStatusItem(90, Commands.setBuildMode, vscode.l10n.t('Baochip: Build Mode')),
		settings: makeStatusItem(89, Commands.openSettings, vscode.l10n.t('Baochip: Settings')),
	};
}
