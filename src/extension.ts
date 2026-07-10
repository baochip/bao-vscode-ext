import { Commands } from '@commands/commandIds';
import {
	getBootloaderSerialPort,
	getBuildTargetOrDefault,
	getDefaultBaud,
	getFlashLocation,
	getMonitorDefaultPort,
	getRunSerialPort,
	getShowWelcome,
	getXousAppName,
} from '@services/configService';
import { getBaochipChannel, log } from '@services/logService';
import { getProjectMode } from '@services/projectModeService';
import { setExtensionContext } from '@services/uvService';
import { autoDetectXousCore } from '@services/xousCoreService';
import { BaoTreeProvider } from '@tree/baoTree';
import { DocsTreeProvider } from '@tree/docsTree';
import { toMessage } from '@util/error';
import { createStatusBarItems } from '@views/statusBar';
import { buildCommandLabel, monitorTooltip } from '@views/uiLabels';
import * as vscode from 'vscode';
import { registerCommands } from './index';

/**
 * Run a best-effort activation step in isolation. A failure (e.g. cfg.update rejecting on a
 * dirty or invalid settings.json) is logged and swallowed so it cannot abort activation and
 * leave the extension with no commands, trees, or status bar.
 */
export async function runStartupStep(label: string, step: () => Promise<void>): Promise<void> {
	try {
		await step();
	} catch (e: unknown) {
		log(`startup step "${label}" failed (continuing): ${toMessage(e)}`);
	}
}

export async function activate(context: vscode.ExtensionContext) {
	setExtensionContext(context);
	context.subscriptions.push(getBaochipChannel()); // dispose the shared output channel on deactivate
	await runStartupStep('auto-detect xous-core', autoDetectXousCore);

	// Sidebar tree
	const tree = new BaoTreeProvider();
	context.subscriptions.push(vscode.window.registerTreeDataProvider('bao-view', tree), tree);

	// Documentation tree
	const docsTree = new DocsTreeProvider();
	context.subscriptions.push(vscode.window.registerTreeDataProvider('bao-docs', docsTree));

	// --- Status bar items (left side) ---
	const items = createStatusBarItems(context);

	// Single UI refresher
	const refreshUI = () => {
		const bootloaderSerPort = getBootloaderSerialPort();
		const runSerPort = getRunSerialPort();
		const baud = getDefaultBaud();
		const flLoc = getFlashLocation();
		const target = getBuildTargetOrDefault();
		const app = getXousAppName();
		const mode = getProjectMode();

		const def = getMonitorDefaultPort(); // "run" | "bootloader"
		const chosenPort = def === 'run' ? runSerPort : bootloaderSerPort;
		const defLabel = def === 'run' ? vscode.l10n.t('Run') : vscode.l10n.t('Bootloader');

		// Bootloader serial port item
		items.bootloaderSerialPort.text = bootloaderSerPort
			? `$(plug) ${bootloaderSerPort}`
			: `$(plug) ${vscode.l10n.t('Bootloader Mode Serial Port: (not set)')}`;
		items.bootloaderSerialPort.tooltip = bootloaderSerPort
			? vscode.l10n.t('Current bootloader mode serial port @ {0}', String(baud))
			: vscode.l10n.t('Click to set bootloader mode serial port');
		items.bootloaderSerialPort.show();

		// Monitor button
		items.monitor.text = chosenPort
			? `$(vm) ${defLabel}: ${chosenPort}`
			: `$(vm) ${vscode.l10n.t('Monitor')}`;
		items.monitor.tooltip = monitorTooltip();
		items.monitor.show();

		// Run serial port item
		items.runSerialPort.text = runSerPort
			? `$(plug) ${runSerPort}`
			: `$(plug) ${vscode.l10n.t('Run Mode Serial Port: (not set)')}`;
		items.runSerialPort.tooltip = runSerPort
			? vscode.l10n.t('Current run mode serial port @ {0}', String(baud))
			: vscode.l10n.t('Click to set run mode serial port');
		items.runSerialPort.show();

		// Flash location
		items.flashLocation.text = flLoc
			? `$(chip) ${flLoc}`
			: `$(chip) ${vscode.l10n.t('Baochip Location: (not set)')}`;
		items.flashLocation.tooltip = flLoc
			? vscode.l10n.t('Current baochip location: {0}', flLoc)
			: vscode.l10n.t('Click to set baochip location');
		items.flashLocation.show();

		// Build target - relevant in both modes; defaults to dabao when not explicitly set
		items.buildTarget.text = `$(target) ${target}`;
		items.buildTarget.tooltip = vscode.l10n.t('Click to select build target');
		items.buildTarget.show();

		// App name - only relevant in xous-core mode
		if (mode === 'xous-core') {
			items.app.text = app ? `$(package) ${app}` : `$(package) ${vscode.l10n.t('App: (not set)')}`;
			items.app.tooltip = vscode.l10n.t('Click to select xous-core app');
			items.app.show();
		} else {
			items.app.hide();
		}

		// Status bar: Clean (keep cargo literal)
		items.clean.text = '$(trash)';
		items.clean.tooltip = vscode.l10n.t('Clean (cargo clean)');
		items.clean.show();

		// Status bar: Build
		items.build.text = '$(tools)';
		items.build.tooltip = buildCommandLabel(mode);
		items.build.show();

		// Status bar: Flash
		items.flash.text = '$(rocket)';
		items.flash.tooltip = vscode.l10n.t('Flash to device');
		items.flash.show();

		// Status bar: B-F-M
		items.buildFlashMonitor.text = '$(rocket) B•F•M';
		items.buildFlashMonitor.tooltip = vscode.l10n.t('Build • Flash • Monitor'); // reuse tree label
		items.buildFlashMonitor.show();

		// Status bar: Settings
		items.settings.text = '$(gear)';
		items.settings.tooltip = vscode.l10n.t('Open Baochip Settings');
		items.settings.show();

		// Status bar: Project mode indicator
		items.buildMode.text = `$(circuit-board) ${mode}`;
		items.buildMode.tooltip = vscode.l10n.t('Build mode: {0} (click to change)', mode);
		items.buildMode.show();

		// One full-tree refresh repaints every node (incl. the monitor); the docs tree is static.
		tree.refresh();
	};

	refreshUI();

	// If any baochip setting changes outside commands (e.g., user edits Settings UI), repaint the UI.
	const cfgWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('baochip')) refreshUI();
	});
	context.subscriptions.push(cfgWatcher);

	// Re-evaluate mode when workspace folders change (e.g. user opens a different project)
	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => refreshUI()));

	registerCommands(context);

	if (getShowWelcome()) {
		vscode.commands.executeCommand(Commands.openWelcome);
	}
}

export function deactivate() {}
