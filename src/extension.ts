import * as vscode from 'vscode';
import { BaoTreeProvider } from '@tree/baoTree';
import { DocsTreeProvider } from '@tree/docsTree';
import { registerCommands } from './index';
import { checkToolsBaoVersion } from '@services/versionService';
import {
  getDefaultBaud,
  getBootloaderSerialPort,
  getFlashLocation,
  getBuildTarget,
  getXousAppName,
  getRunSerialPort,
  getMonitorDefaultPort, 
} from '@services/configService';

const shouldShowWelcome = () =>
  vscode.workspace.getConfiguration().get<boolean>('baochip.showWelcomeOnStartup', true);

export function activate(context: vscode.ExtensionContext) {
  // Check on activation (non-blocking)
  checkToolsBaoVersion();

  // Sidebar tree
  const tree = new BaoTreeProvider();
  vscode.window.registerTreeDataProvider('bao-view', tree);

  // Documentation tree
  const docsTree = new DocsTreeProvider();
  vscode.window.registerTreeDataProvider('bao-docs', docsTree); 

  // --- Status bar items (left side) ---
  // Higher priority number = appears more to the left
  const bootloaderSerialPortItem   = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  const runSerialPortItem   = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  const flashLocationItem  = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  const targetItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
  const appItem    = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
  const cleanItem  = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
  const buildItem  = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 94);
  const flashItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 93);
  const monitorBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 92);
  const bfmItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 91);
  const settingsItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);


  bootloaderSerialPortItem.command   = 'baochip.setBootloaderSerialPort';
  runSerialPortItem.command = 'baochip.setRunSerialPort';
  monitorBtn.command = 'baochip.openMonitor';
  flashLocationItem.command  = 'baochip.setFlashLocation';
  targetItem.command = 'baochip.selectBuildTarget';
  cleanItem.command = 'baochip.clean';
  buildItem.command = 'baochip.build';
  appItem.command   = 'baochip.selectApp';
  flashItem.command = 'baochip.flash';
  bfmItem.command   = 'baochip.buildFlashMonitor';
  settingsItem.command = 'baochip.openSettings';

  context.subscriptions.push(bootloaderSerialPortItem, runSerialPortItem, monitorBtn, flashLocationItem, targetItem, cleanItem, buildItem, appItem, flashItem, bfmItem, settingsItem);

  // Single UI refresher
  const refreshUI = () => {
    const bootloaderSerPort = getBootloaderSerialPort();
    const runSerPort = getRunSerialPort();
    const baud    = getDefaultBaud();
    const flLoc   = getFlashLocation();
    const target  = getBuildTarget();
    const app      = getXousAppName();

  const def = getMonitorDefaultPort(); // "run" | "bootloader"
  const chosenPort = def === 'run' ? runSerPort : bootloaderSerPort;
  const defLabel = def === 'run' ? 'Run' : 'Bootloader';

    // Bootloader serial port item
    bootloaderSerialPortItem.text = bootloaderSerPort ? `$(plug) ${bootloaderSerPort}` : '$(plug) Bootloader Mode Serial Port: (not set)';
    bootloaderSerialPortItem.tooltip = bootloaderSerPort
      ? `Current bootloader mode serial port @ ${baud}`
      : 'Click to set bootloader mode serial port';
    bootloaderSerialPortItem.show();

    // Bootloader Monitor button 
    if (chosenPort) {
      monitorBtn.text = `$(vm) ${defLabel}: ${chosenPort}`;
      monitorBtn.tooltip = `Open monitor on ${defLabel} port ${chosenPort} @ ${baud}`;
    } else {
      monitorBtn.text = '$(vm) Monitor';
      monitorBtn.tooltip =
        def === 'run'
          ? 'Open monitor (run mode serial port not set)'
          : 'Open monitor (bootloader mode serial port not set)';
    }
    monitorBtn.show();

    // Run serial port item
    runSerialPortItem.text = runSerPort ? `$(plug) ${runSerPort}` : '$(plug) Run Mode Serial Port: (not set)';
    runSerialPortItem.tooltip = runSerPort
      ? `Current run mode serial port @ ${baud}`
      : 'Click to set run mode serial port';
    runSerialPortItem.show();

    // Flash location
    flashLocationItem.text = flLoc ? `$(chip) ${flLoc}` : '$(chip) Baochip Location: (not set)';
    flashLocationItem.tooltip = 'Click to set baochip location';
    flashLocationItem.show();

    // Build target
    targetItem.text = target ? `$(target) ${target}` : '$(target) Target: (not set)';
    targetItem.tooltip = 'Click to select build target';
    targetItem.show();

    // App name
    appItem.text = app ? `$(package) ${app}` : '$(package) App: (not set)';
    appItem.tooltip = 'Click to select xous-core app';
    appItem.show();

    // Status bar: Full Clean
    cleanItem.text = '$(trash)';
    cleanItem.tooltip = 'Full clean (cargo clean)';
    cleanItem.show();

    // Status bar: Build
    buildItem.text = '$(tools)';
    buildItem.tooltip = 'Build (cargo xtask)';
    buildItem.show();

    // Status bar: Flash
    flashItem.text = '$(rocket)';
    flashItem.tooltip = 'Flash to device';
    flashItem.show();

    // Status bar: B•F•M
    bfmItem.text = '$(rocket) B•F•M';
    bfmItem.tooltip = 'Build • Flash • Monitor';
    bfmItem.show();

    // Status bar: Settings
    settingsItem.text = '$(gear)';
    settingsItem.tooltip = 'Open Baochip Settings';
    settingsItem.show();

    tree.refresh();
    tree.refreshMonitor();
    docsTree.refresh();
  };

  refreshUI();

  // If settings change outside commands (e.g., user edits Settings UI), auto-update status bar
  const cfgWatcher = vscode.workspace.onDidChangeConfiguration(e => {
    if (
      e.affectsConfiguration('baochip.monitorDefaultPort') || 
      e.affectsConfiguration('baochip.serialPortBootloader')  ||
      e.affectsConfiguration('baochip.serialPortRun')  ||
      e.affectsConfiguration('baochip.monitor.defaultBaud')  ||
      e.affectsConfiguration('baochip.flashPort')    ||
      e.affectsConfiguration('baochip.buildTarget')  ||
      e.affectsConfiguration('baochip.xousAppName')  
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
