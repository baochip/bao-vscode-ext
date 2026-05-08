import {
	getBootloaderSerialPort,
	getBuildTarget,
	getDefaultBaud,
	getFlashLocation,
	getMonitorDefaultPort,
	getRunSerialPort,
	getXousAppName,
} from '@services/configService';
import { resetUvSetup, setExtensionContext } from '@services/uvService';
import { BaoTreeProvider } from '@tree/baoTree';
import { DocsTreeProvider } from '@tree/docsTree';
import * as vscode from 'vscode';
import { registerCommands } from './index';

const shouldShowWelcome = () =>
	vscode.workspace.getConfiguration().get<boolean>('baochip.showWelcomeOnStartup', true);

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

	// Sidebar tree
	const tree = new BaoTreeProvider();
	vscode.window.registerTreeDataProvider('bao-view', tree);

	// Documentation tree
	const docsTree = new DocsTreeProvider();
	vscode.window.registerTreeDataProvider('bao-docs', docsTree);

	// --- Status bar items (left side) ---
	// Higher priority number = appears more to the left
	function makeStatusItem(priority: number, command: string): vscode.StatusBarItem {
		const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, priority);
		item.command = command;
		context.subscriptions.push(item);
		return item;
	}

	const bootloaderSerialPortItem = makeStatusItem(100, 'baochip.setBootloaderSerialPort');
	const runSerialPortItem = makeStatusItem(99, 'baochip.setRunSerialPort');
	const flashLocationItem = makeStatusItem(98, 'baochip.setFlashLocation');
	const targetItem = makeStatusItem(97, 'baochip.selectBuildTarget');
	const appItem = makeStatusItem(96, 'baochip.selectApp');
	const cleanItem = makeStatusItem(95, 'baochip.clean');
	const buildItem = makeStatusItem(94, 'baochip.build');
	const flashItem = makeStatusItem(93, 'baochip.flash');
	const monitorBtn = makeStatusItem(92, 'baochip.openMonitor');
	const bfmItem = makeStatusItem(91, 'baochip.buildFlashMonitor');
	const settingsItem = makeStatusItem(90, 'baochip.openSettings');

	context.subscriptions.push(
		vscode.commands.registerCommand('baochip.resetUvSetup', async () => {
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

		// Build target
		targetItem.text = target
			? `$(target) ${target}`
			: `$(target) ${vscode.l10n.t('Target: (not set)')}`;
		targetItem.tooltip = vscode.l10n.t('Click to select build target');
		targetItem.show();

		// App name
		appItem.text = app ? `$(package) ${app}` : `$(package) ${vscode.l10n.t('App: (not set)')}`;
		appItem.tooltip = vscode.l10n.t('Click to select xous-core app');
		appItem.show();

		// Status bar: Full Clean (keep cargo literal)
		cleanItem.text = '$(trash)';
		cleanItem.tooltip = vscode.l10n.t('Full clean (cargo clean)'); // "Full clean (cargo clean)"
		cleanItem.show();

		// Status bar: Build (keep cargo literal)
		buildItem.text = '$(tools)';
		buildItem.tooltip = vscode.l10n.t('Build (cargo xtask)'); // "Build (cargo xtask)"
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

		tree.refresh();
		tree.refreshMonitor();
		docsTree.refresh();
	};

	refreshUI();

	// If settings change outside commands (e.g., user edits Settings UI), auto-update status bar
	const cfgWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
		if (
			e.affectsConfiguration('baochip.monitorDefaultPort') ||
			e.affectsConfiguration('baochip.serialPortBootloader') ||
			e.affectsConfiguration('baochip.serialPortRun') ||
			e.affectsConfiguration('baochip.monitor.defaultBaud') ||
			e.affectsConfiguration('baochip.buildTarget') ||
			e.affectsConfiguration('baochip.xousAppName') ||
			e.affectsConfiguration('baochip.flashLocation')
		) {
			refreshUI();
		}
	});
	context.subscriptions.push(cfgWatcher);

	registerCommands(context, refreshUI);

	if (shouldShowWelcome()) {
		vscode.commands.executeCommand('baochip.openWelcome');
	}
}

export function deactivate() {}
