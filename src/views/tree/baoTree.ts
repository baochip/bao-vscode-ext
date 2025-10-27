import * as vscode from 'vscode';

export class BaoTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  refresh() { this._onDidChangeTreeData.fire(undefined); }
  getTreeItem(el: TreeItem) { return el; }
  getChildren() {
    const welcome = new TreeItem('Welcome', 'baochip.openWelcome', 'home');
    const setPort = new TreeItem('Set monitor port', 'baochip.setMonitorPort', 'plug');
    const setFlashLoc = new TreeItem('Set baochip location', 'baochip.setFlashLocation', 'chip');
    const target   = new TreeItem('Select build target', 'baochip.selectBuildTarget', 'target');
    const newApp   = new TreeItem('New app', 'baochip.createApp', 'add');
    const selectApp = new TreeItem('Select app', 'baochip.selectApp', 'search');
    const clean    = new TreeItem('Clean (cargo clean)', 'baochip.clean', 'trash');
    const build    = new TreeItem('Build (cargo xtask)', 'baochip.build', 'tools');
    const flash     = new TreeItem('Flash device', 'baochip.flash', 'rocket');
    const flashForceAll = new TreeItem('Flash device (force all)', 'baochip.flashForceAll', 'rocket');
    const monitor = new TreeItem('Monitor', 'baochip.openMonitor', 'vm');
    const bfm = new TreeItem('Build • Flash • Monitor', 'baochip.buildFlashMonitor', 'rocket');
    const settings = new TreeItem('Open Settings', 'baochip.openSettings', 'gear');
    return Promise.resolve([setPort, setFlashLoc, target, newApp, selectApp, clean, build, flash, flashForceAll, monitor, bfm, settings]);
  }
}

class TreeItem extends vscode.TreeItem {
  constructor(label: string, commandId?: string, icon?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (commandId) this.command = { title: label, command: commandId };
    this.iconPath = new vscode.ThemeIcon(icon || 'circle-large-outline');
  }
}
