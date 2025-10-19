import * as vscode from 'vscode';
import { BaoTreeProvider } from '@tree/baoTree';
import { registerCommands } from './index';
import {
  getDefaultBaud,
  getMonitorPort,
  getFlashLocation,
  getBuildTarget,
  getXousAppName
} from '@services/configService';

const shouldShowWelcome = () =>
  vscode.workspace.getConfiguration().get<boolean>('baochip.showWelcomeOnStartup', true);

export function activate(context: vscode.ExtensionContext) {
  // Sidebar tree
  const tree = new BaoTreeProvider();
  vscode.window.registerTreeDataProvider('bao-view', tree);

  // --- Status bar items (left side) ---
  // Higher priority number = appears more to the left
  const monitorPortItem   = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  const flashLocationItem  = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  const targetItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  const appItem    = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
  const cleanItem  = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);
  const buildItem  = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 95);
  const flashItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 94);
  const monitorBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 93);
  const bfmItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 92);


  monitorPortItem.command   = 'baochip.setMonitorPort';
  monitorBtn.command = 'baochip.openMonitor';
  flashLocationItem.command  = 'baochip.setFlashLocation';
  targetItem.command = 'baochip.selectBuildTarget';
  cleanItem.command = 'baochip.clean';
  buildItem.command = 'baochip.build';
  appItem.command   = 'baochip.selectApp';
  flashItem.command = 'baochip.flash';
  bfmItem.command   = 'baochip.buildFlashMonitor';

  context.subscriptions.push(monitorPortItem, monitorBtn, flashLocationItem, targetItem, cleanItem, buildItem, appItem, flashItem, bfmItem);

  // Single UI refresher
  const refreshUI = () => {
    const monPort = getMonitorPort();
    const baud    = getDefaultBaud();
    const flLoc   = getFlashLocation();
    const target  = getBuildTarget();
    const app      = getXousAppName();

    // Monitor port item
    monitorPortItem.text = monPort ? `$(plug) ${monPort}` : '$(plug) Monitor Port: (not set)';
    monitorPortItem.tooltip = monPort
      ? `Current monitor port @ ${baud}`
      : 'Click to set monitor port';
    monitorPortItem.show();

    // Monitor button 
    monitorBtn.text = '$(vm)';
    monitorBtn.tooltip = monPort
      ? `Open monitor on ${monPort} @ ${baud}`
      : 'Open monitor (will ask you to set a port first)';
    monitorBtn.show();

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

    tree.refresh();
  };

  refreshUI();

  // If settings change outside commands (e.g., user edits Settings UI), auto-update status bar
  const cfgWatcher = vscode.workspace.onDidChangeConfiguration(e => {
    if (
      e.affectsConfiguration('baochip.monitorPort')  ||
      e.affectsConfiguration('baochip.defaultBaud')  ||
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
