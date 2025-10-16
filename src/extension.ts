import * as vscode from 'vscode';
import { BaoTreeProvider } from '@views/baoTree';
import { registerCommands } from '@commands/index';
import {
  getDefaultBaud,
  getMonitorPort,
  getFlashPort,
  getBuildTarget,
  getFlashMethod
} from '@services/configService';

export function activate(context: vscode.ExtensionContext) {
  // Sidebar tree
  const tree = new BaoTreeProvider();
  vscode.window.registerTreeDataProvider('bao-view', tree);

  // --- Status bar items (left side) ---
  // Higher priority number = appears more to the left
  const portItem   = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  const flashItem  = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  const methodItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  const monitorBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);
  const targetItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 96);

  portItem.command   = 'baochip.setMonitorPort';
  monitorBtn.command = 'baochip.openMonitor';
  flashItem.command  = 'baochip.setFlashPort';
  targetItem.command = 'baochip.selectBuildTarget';
  methodItem.command = 'baochip.setFlashMethod';

  context.subscriptions.push(portItem, monitorBtn, flashItem, targetItem, methodItem);

  // Single UI refresher
  const refreshUI = () => {
    const monPort = getMonitorPort();
    const baud    = getDefaultBaud();
    const flPort  = getFlashPort();
    const target  = getBuildTarget();
    const fMethod  = getFlashMethod();

    // Monitor port item
    portItem.text = monPort ? `$(plug) Monitor Port: ${monPort}` : '$(plug) Monitor Port: (not set)';
    portItem.tooltip = monPort
      ? `Current monitor port @ ${baud}`
      : 'Click to set monitor port';
    portItem.show();

    // Monitor button 
    monitorBtn.text = '$(vm) Monitor';
    monitorBtn.tooltip = monPort
      ? `Open monitor on ${monPort} @ ${baud}`
      : 'Open monitor (will ask you to set a port first)';
    monitorBtn.show();

    // Flash port
    flashItem.text = flPort ? `$(plug) Flash Port: ${flPort}` : '$(plug) Flash Port: (not set)';
    flashItem.tooltip = 'Click to set flash port';
    flashItem.show();

    // Flash method
    methodItem.text = fMethod ? `$(star) Flash: ${fMethod}` : '$(star) Flash: (not set)';
    methodItem.tooltip = 'Click to select flash method';
    methodItem.show();

    // Build target
    targetItem.text = target ? `$(target) Target: ${target}` : '$(target) Target: (not set)';
    targetItem.tooltip = 'Click to select build target';
    targetItem.show();

    // Refresh tree view (labels/icons don’t change, but good if you add dynamic labels later)
    tree.refresh();
  };

  // Initial paint
  refreshUI();

  // If settings change outside commands (e.g., user edits Settings UI), auto-update status bar
  const cfgWatcher = vscode.workspace.onDidChangeConfiguration(e => {
    if (
      e.affectsConfiguration('baochip.monitorPort')  ||
      e.affectsConfiguration('baochip.defaultBaud')  ||
      e.affectsConfiguration('baochip.flashPort')    ||
      e.affectsConfiguration('baochip.buildTarget')
    ) {
      refreshUI();
    }
  });
  context.subscriptions.push(cfgWatcher);

  // Register commands; they’ll call refreshUI() after changing settings
  registerCommands(context, refreshUI);
}

export function deactivate() {}
