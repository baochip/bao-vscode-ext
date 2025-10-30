// baoTree.ts
import * as vscode from 'vscode';
import { getMonitorDefaultPort } from '@services/configService';

export class BaoTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private monitorNode = new TreeItem(
    'Monitor',
    undefined,
    'vm',
    vscode.TreeItemCollapsibleState.Collapsed
  );

  // 🔹 call this to just update the Monitor section
  refreshMonitor() { this._onDidChangeTreeData.fire(this.monitorNode); }

  refresh() { this._onDidChangeTreeData.fire(undefined); }
  getTreeItem(el: TreeItem) { return el; }

  getChildren(element?: TreeItem) {
    if (!element) {
      const setBootloaderPort = new TreeItem('Set bootloader mode serial port', 'baochip.setBootloaderSerialPort', 'plug');
      const setRunPort = new TreeItem('Set run mode serial port', 'baochip.setRunSerialPort', 'plug');
      const setFlashLoc = new TreeItem('Set baochip location', 'baochip.setFlashLocation', 'chip');
      const target   = new TreeItem('Select build target', 'baochip.selectBuildTarget', 'target');
      const newApp   = new TreeItem('New app', 'baochip.createApp', 'add');
      const selectApp = new TreeItem('Select app', 'baochip.selectApp', 'search');
      const clean    = new TreeItem('Clean (cargo clean)', 'baochip.clean', 'trash');
      const build    = new TreeItem('Build (cargo xtask)', 'baochip.build', 'tools');
      const flash     = new TreeItem('Flash device', 'baochip.flash', 'rocket');
      const bfm = new TreeItem('Build • Flash • Monitor', 'baochip.buildFlashMonitor', 'rocket');
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
        this.monitorNode, // ← collapsible Monitor
        bfm,
        settings
      ]);
    }

    if (element === this.monitorNode) {
      const def = getMonitorDefaultPort(); // "run" | "bootloader"
      const defLabel = def === 'run' ? 'Run' : 'Bootloader';
      const defaultMonChild = new TreeItem(`Default monitor: ${defLabel}`, 'baochip.setMonitorDefaultPort', 'gear');
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
