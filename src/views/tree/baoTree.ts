import * as vscode from 'vscode';
import {
  getMonitorDefaultPort,
  getRunSerialPort,
  getBootloaderSerialPort,
  getDefaultBaud,
} from '@services/configService';

export class BaoTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private monitorNode = new TreeItem(
    'Monitor',
    'baochip.openMonitor',
    'vm',
    vscode.TreeItemCollapsibleState.Collapsed
  );

  refresh() { this._onDidChangeTreeData.fire(undefined); }
  refreshMonitor() { this._onDidChangeTreeData.fire(this.monitorNode); }

  getTreeItem(el: TreeItem) {
    // Dynamically update tooltip to show the chosen mode/port/baud
    if (el === this.monitorNode) {
      const def = getMonitorDefaultPort(); // "run" | "bootloader"
      const port = def === 'run' ? getRunSerialPort() : getBootloaderSerialPort();
      const baud = getDefaultBaud();
      const mode = def === 'run' ? 'Run' : 'Bootloader';
      el.tooltip = port
        ? `Open monitor on ${mode} port ${port} @ ${baud}`
        : `Open monitor (${mode.toLowerCase()} port not set)`;
    }
    return el;
  }

  getChildren(element?: TreeItem) {
    if (!element) {
      const welcome = new TreeItem('Welcome', 'baochip.openWelcome', 'home');
      const setBootloaderPort = new TreeItem('Set bootloader mode serial port', 'baochip.setBootloaderSerialPort', 'plug');
      const setRunPort = new TreeItem('Set run mode serial port', 'baochip.setRunSerialPort', 'plug');
      const setFlashLoc = new TreeItem('Set baochip location', 'baochip.setFlashLocation', 'chip');
      const target   = new TreeItem('Select build target', 'baochip.selectBuildTarget', 'target');
      const newApp   = new TreeItem('New app', 'baochip.createApp', 'add');
      const selectApp = new TreeItem('Select app', 'baochip.selectApp', 'search');
      const clean    = new TreeItem('Clean (cargo clean)', 'baochip.clean', 'trash');
      const build    = new TreeItem('Build (cargo xtask)', 'baochip.build', 'tools');
      const flash    = new TreeItem('Flash device', 'baochip.flash', 'rocket');
      const bfm      = new TreeItem('Build • Flash • Monitor', 'baochip.buildFlashMonitor', 'rocket');
      const settings = new TreeItem('Open Settings', 'baochip.openSettings', 'gear');

      return Promise.resolve([
        setBootloaderPort,
        setRunPort,
        setFlashLoc,
        target,
        newApp,
        selectApp,
        clean,
        build,
        flash,
        this.monitorNode,
        bfm,
        settings
      ]);
    }

    if (element === this.monitorNode) {
      const def = getMonitorDefaultPort();
      const label = def === 'run' ? 'Run' : 'Bootloader';
      const defaultMonChild = new TreeItem(
        `Default monitor: ${label}`,
        'baochip.setMonitorDefaultPort',
        'gear'
      );
      return Promise.resolve([defaultMonChild]);
    }

    return Promise.resolve([]);
  }
}

class TreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    commandId?: string,
    icon?: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None
  ) {
    super(label, collapsibleState);
    if (commandId) this.command = { title: label, command: commandId };
    this.iconPath = new vscode.ThemeIcon(icon || 'circle-large-outline');
  }
}
