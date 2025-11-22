import * as path from 'node:path';
import {
	getBootloaderSerialPort,
	getBuildTarget,
	getDefaultBaud,
	getFlashLocation,
	getMonitorDefaultPort,
	getRunSerialPort,
	getXousAppName,
} from '@services/configService';
import {
	ensureBaoPythonDeps,
	ensureXousCorePath,
	resetUvSetup,
	setExtensionContext,
} from '@services/pathService';
import { checkToolsBaoVersion } from '@services/versionService';
import { BaoTreeProvider } from '@tree/baoTree';
import { DocsTreeProvider } from '@tree/docsTree';
import * as vscode from 'vscode';
import { registerCommands } from './index';

const shouldShowWelcome = () =>
	vscode.workspace.getConfiguration().get<boolean>('baochip.showWelcomeOnStartup', true);

export async function activate(context: vscode.ExtensionContext) {
	setExtensionContext(context);
	// Check on activation (non-blocking)
	checkToolsBaoVersion();

	// Sidebar tree
	const tree = new BaoTreeProvider();
	vscode.window.registerTreeDataProvider('bao-view', tree);

	// Documentation tree
	const docsTree = new DocsTreeProvider();
	vscode.window.registerTreeDataProvider('bao-docs', docsTree);

	// --- Prep Python deps once on activation (quiet) and watch requirements.txt for changes ---
	try {
		const root = await ensureXousCorePath(); // user may cancel; that's OK
		await ensureBaoPythonDeps(root, { quiet: true });
		wireRequirementsWatcher(context, root);
	} catch {
		// No xous-core yet — skip for now; we’ll catch it when the user sets the path.
	}

	// Re-run deps once when the user updates xous-core path later
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async (e) => {
			if (!e.affectsConfiguration('baochip.xousCorePath')) return;
			try {
				const newRoot = await ensureXousCorePath();
				await ensureBaoPythonDeps(newRoot, { quiet: true });
				wireRequirementsWatcher(context, newRoot);
			} catch {
				/* ignore */
			}
		}),
	);

	// --- Status bar items (left side) ---
	// Higher priority number = appears more to the left
	const bootloaderSerialPortItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		100,
	);
	const runSerialPortItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	const flashLocationItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
	const targetItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
	const appItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
	const cleanItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
	const buildItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 94);
	const flashItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 93);
	const monitorBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 92);
	const bfmItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 91);
	const settingsItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);

	bootloaderSerialPortItem.command = 'baochip.setBootloaderSerialPort';
	runSerialPortItem.command = 'baochip.setRunSerialPort';
	monitorBtn.command = 'baochip.openMonitor';
	flashLocationItem.command = 'baochip.setFlashLocation';
	targetItem.command = 'baochip.selectBuildTarget';
	cleanItem.command = 'baochip.clean';
	buildItem.command = 'baochip.build';
	appItem.command = 'baochip.selectApp';
	flashItem.command = 'baochip.flash';
	bfmItem.command = 'baochip.buildFlashMonitor';
	settingsItem.command = 'baochip.openSettings';

	context.subscriptions.push(
		bootloaderSerialPortItem,
		runSerialPortItem,
		monitorBtn,
		flashLocationItem,
		targetItem,
		cleanItem,
		buildItem,
		appItem,
		flashItem,
		bfmItem,
		settingsItem,
	);

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
			e.affectsConfiguration('baochip.flashPort') ||
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

function wireRequirementsWatcher(context: vscode.ExtensionContext, xousRoot: string) {
	const reqAbs = path.join(xousRoot, 'tools-bao', 'requirements.txt');
	const watcher = vscode.workspace.createFileSystemWatcher(reqAbs);

	const reinstallQuietly = async () => {
		try {
			await ensureBaoPythonDeps(xousRoot, { quiet: true });
		} catch {
			/* ignore — user will see errors if they actually run a command */
		}
	};

	context.subscriptions.push(
		watcher,
		watcher.onDidCreate(reinstallQuietly),
		watcher.onDidChange(reinstallQuietly),
		watcher.onDidDelete(reinstallQuietly),
	);
}
