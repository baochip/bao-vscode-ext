import * as vscode from 'vscode';
import { BaoTreeProvider } from './views/baoTree';
import { registerCommands } from './commands/index';
import { getDefaultBaud, getMonitorPort, getFlashPort } from './services/configService';

export function activate(context: vscode.ExtensionContext) {
  const tree = new BaoTreeProvider();
  vscode.window.registerTreeDataProvider('bao-view', tree);

  // Status bar: port
  const portItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  portItem.command = 'baochip.setMonitorPort';
  const refreshUI = () => {
    const p = getMonitorPort();
    portItem.text = p ? `$(plug) Bao Port: ${p}` : '$(plug) Bao Port: (not set)';
    portItem.tooltip = p ? `Current monitor port @ ${getDefaultBaud()}` : 'Click to set monitor port';
    portItem.show();
    tree.refresh();
  };
  refreshUI();
  context.subscriptions.push(portItem);

  // Status bar: monitor button
  const monitorItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  monitorItem.command = 'baochip.openMonitor';
  monitorItem.text = '$(vm) Monitor';
  monitorItem.tooltip = 'Open serial monitor';
  monitorItem.show();
  context.subscriptions.push(monitorItem);

  // Status bar: flash port
  const flashItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  flashItem.command = 'baochip.setFlashPort';
  const refreshFlashItem = () => {
    const p = getFlashPort();
    flashItem.text = p ? `$(zap) Flash Port: ${p}` : '$(zap) Flash Port: (not set)';
    flashItem.tooltip = 'Click to set flash port';
    flashItem.show();
  };
  refreshFlashItem();
  context.subscriptions.push(flashItem);


  // Commands
  registerCommands(context, refreshUI);
}

export function deactivate() {}
