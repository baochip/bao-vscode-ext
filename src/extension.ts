import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import {
	getBootloaderSerialPort,
	getBuildTarget,
	getDefaultBaud,
	getFlashLocation,
	getMonitorDefaultPort,
	getRunSerialPort,
	getShowWelcome,
	getXousAppName,
} from '@services/configService';
import { getProjectMode } from '@services/projectModeService';
import { resetUvSetup, setExtensionContext } from '@services/uvService';
import { autoDetectXousCore } from '@services/xousCoreService';
import { BaoTreeProvider } from '@tree/baoTree';
import { DocsTreeProvider } from '@tree/docsTree';
import * as vscode from 'vscode';
import { registerCommands } from './index';

const migrateWelcomeSettingToGlobal = async () => {
	const cfg = vscode.workspace.getConfiguration();
	const showInspect = cfg.inspect<boolean>('baochip.showWelcomeOnStartup');
	if (!showInspect) return;

	const workspaceShowValues = [showInspect.workspaceValue, showInspect.workspaceFolderValue].filter(
		(v) => v !== undefined,
	) as boolean[];
	const hasWorkspaceShow = workspaceShowValues.length > 0;

	const globalShowSet = showInspect.globalValue !== undefined;

	// Derive global show from workspace/folder show if no global set
	if (!globalShowSet && hasWorkspaceShow) {
		const chosen = workspaceShowValues.find((v) => v !== undefined);
		if (chosen !== undefined) {
			await cfg.update('baochip.showWelcomeOnStartup', chosen, vscode.ConfigurationTarget.Global);
		}
	}

	// Clean workspace/folder show entries
	if (hasWorkspaceShow) {
		await cfg.update(
			'baochip.showWelcomeOnStartup',
			undefined,
			vscode.ConfigurationTarget.Workspace,
		);

		for (const folder of vscode.workspace.workspaceFolders ?? []) {
			const folderCfg = vscode.workspace.getConfiguration(undefined, folder.uri);
			await folderCfg.update(
				'baochip.showWelcomeOnStartup',
				undefined,
				vscode.ConfigurationTarget.WorkspaceFolder,
			);
		}
	}
};

export async function activate(context: vscode.ExtensionContext) {
	setExtensionContext(context);
	await migrateWelcomeSettingToGlobal();
	await autoDetectXousCore();

	// Sidebar tree
	const tree = new BaoTreeProvider();
	context.subscriptions.push(vscode.window.registerTreeDataProvider('bao-view', tree));

	// Documentation tree
	const docsTree = new DocsTreeProvider();
	context.subscriptions.push(vscode.window.registerTreeDataProvider('bao-docs', docsTree));

	// --- Status bar items (left side) ---
	// Higher priority number = appears more to the left
	function makeStatusItem(priority: number, command: string): vscode.StatusBarItem {
		const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
		item.command = command;
		context.subscriptions.push(item);
		return item;
	}

	const bootloaderSerialPortItem = makeStatusItem(100, Commands.setBootloaderSerialPort);
	const runSerialPortItem = makeStatusItem(99, Commands.setRunSerialPort);
	const flashLocationItem = makeStatusItem(98, Commands.setFlashLocation);
	const targetItem = makeStatusItem(97, Commands.selectBuildTarget);
	const appItem = makeStatusItem(96, Commands.selectApp);
	const cleanItem = makeStatusItem(95, Commands.clean);
	const buildItem = makeStatusItem(94, Commands.build);
	const flashItem = makeStatusItem(93, Commands.flash);
	const monitorBtn = makeStatusItem(92, Commands.openMonitor);
	const bfmItem = makeStatusItem(91, Commands.buildFlashMonitor);
	const modeItem = makeStatusItem(90, Commands.setBuildMode);
	const settingsItem = makeStatusItem(89, Commands.openSettings);

	context.subscriptions.push(
		withCommand(Commands.resetUvSetup, async () => {
			await resetUvSetup();
		}),
	);

	// Single UI refresher
	const refreshUI = () => {
		const bootloaderSerPort = getBootloaderSerialPort();
		const runSerPort = getRunSerialPort();
		const baud = getDefaultBaud();
		const flLoc = getFlashLocation();
		const target = getBuildTarget();
		const app = getXousAppName();
		const mode = getProjectMode();

		const def = getMonitorDefaultPort(); // "run" | "bootloader"
		const chosenPort = def === 'run' ? runSerPort : bootloaderSerPort;
		const defLabel = def === 'run' ? vscode.l10n.t('Run') : vscode.l10n.t('Bootloader');

		// Bootloader serial port item
		bootloaderSerialPortItem.text = bootloaderSerPort
			? `$(plug) ${bootloaderSerPort}`
			: `$(plug) ${vscode.l10n.t('Bootloader Mode Serial Port: (not set)')}`;
		bootloaderSerialPortItem.tooltip = bootloaderSerPort
			? vscode.l10n.t('Current bootloader mode serial port @ {0}', String(baud))
			: vscode.l10n.t('Click to set bootloader mode serial port');
		bootloaderSerialPortItem.show();

		// Monitor button
		if (chosenPort) {
			monitorBtn.text = `$(vm) ${defLabel}: ${chosenPort}`;
			monitorBtn.tooltip = vscode.l10n.t(
				'Open monitor on {0} port {1} @ {2}',
				defLabel,
				chosenPort,
				String(baud),
			);
		} else {
			monitorBtn.text = `$(vm) ${vscode.l10n.t('Monitor')}`;
			monitorBtn.tooltip =
				def === 'run'
					? vscode.l10n.t('Open monitor (run mode serial port not set)')
					: vscode.l10n.t('Open monitor (bootloader mode serial port not set)');
		}
		monitorBtn.show();

		// Run serial port item
		runSerialPortItem.text = runSerPort
			? `$(plug) ${runSerPort}`
			: `$(plug) ${vscode.l10n.t('Run Mode Serial Port: (not set)')}`;
		runSerialPortItem.tooltip = runSerPort
			? vscode.l10n.t('Current run mode serial port @ {0}', String(baud))
			: vscode.l10n.t('Click to set run mode serial port');
		runSerialPortItem.show();

		// Flash location
		flashLocationItem.text = flLoc
			? `$(chip) ${flLoc}`
			: `$(chip) ${vscode.l10n.t('Baochip Location: (not set)')}`;
		flashLocationItem.tooltip = vscode.l10n.t('Click to set baochip location');
		flashLocationItem.show();

		// Build target — relevant in both modes; defaults to dabao when not explicitly set
		targetItem.text = `$(target) ${target || 'dabao'}`;
		targetItem.tooltip = vscode.l10n.t('Click to select build target');
		targetItem.show();

		// App name — only relevant in xous-core mode
		if (mode === 'xous-core') {
			appItem.text = app ? `$(package) ${app}` : `$(package) ${vscode.l10n.t('App: (not set)')}`;
			appItem.tooltip = vscode.l10n.t('Click to select xous-core app');
			appItem.show();
		} else {
			appItem.hide();
		}

		// Status bar: Clean (keep cargo literal)
		cleanItem.text = '$(trash)';
		cleanItem.tooltip = vscode.l10n.t('Clean (cargo clean)');
		cleanItem.show();

		// Status bar: Build
		buildItem.text = '$(tools)';
		buildItem.tooltip =
			mode === 'xous-core'
				? vscode.l10n.t('Build (cargo xtask)')
				: vscode.l10n.t('Build (cargo build)');
		buildItem.show();

		// Status bar: Flash
		flashItem.text = '$(rocket)';
		flashItem.tooltip = vscode.l10n.t('Flash to device');
		flashItem.show();

		// Status bar: B•F•M
		bfmItem.text = '$(rocket) B•F•M';
		bfmItem.tooltip = vscode.l10n.t('Build • Flash • Monitor'); // reuse tree label
		bfmItem.show();

		// Status bar: Settings
		settingsItem.text = '$(gear)';
		settingsItem.tooltip = vscode.l10n.t('Open Baochip Settings');
		settingsItem.show();

		// Status bar: Project mode indicator
		modeItem.text = `$(circuit-board) ${mode}`;
		modeItem.tooltip = vscode.l10n.t('Build mode: {0} (click to change in settings)', mode);
		modeItem.show();

		tree.refresh();
		tree.refreshMonitor();
		docsTree.refresh();
	};

	refreshUI();

	// If any baochip setting changes outside commands (e.g., user edits Settings UI), repaint the UI.
	const cfgWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('baochip')) refreshUI();
	});
	context.subscriptions.push(cfgWatcher);

	// Re-evaluate mode when workspace folders change (e.g. user opens a different project)
	context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => refreshUI()));

	registerCommands(context, refreshUI);

	if (getShowWelcome()) {
		vscode.commands.executeCommand(Commands.openWelcome);
	}
}

export function deactivate() {}
