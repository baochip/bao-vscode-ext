import * as vscode from 'vscode';

export class BaoTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  refresh() { this._onDidChangeTreeData.fire(undefined); }
  getTreeItem(el: TreeItem) { return el; }
  getChildren() {
    const welcome = new TreeItem('Welcome', 'baochip.openWelcome', 'home');
    const setPort = new TreeItem('Set monitor port', 'baochip.setMonitorPort', 'plug');
    const setFlash = new TreeItem('Set flash port', 'baochip.setFlashPort', 'plug');
    const flashMeth = new TreeItem('Select flash method','baochip.setFlashMethod', 'star');
    const target   = new TreeItem('Select build target', 'baochip.selectBuildTarget', 'target');
    const newApp   = new TreeItem('New app', 'baochip.createApp', 'add');
    const selectApp = new TreeItem('Select app', 'baochip.selectApp', 'search');
    const clean    = new TreeItem('Clean (cargo clean)', 'baochip.clean', 'trash');
    const build    = new TreeItem('Build (cargo xtask)', 'baochip.build', 'tools');
    const monitor = new TreeItem('Monitor', 'baochip.openMonitor', 'vm');
    return Promise.resolve([setPort, setFlash, flashMeth, target, newApp, selectApp, clean, build, monitor]);
  }
}

class TreeItem extends vscode.TreeItem {
  constructor(label: string, commandId?: string, icon?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (commandId) this.command = { title: label, command: commandId };
    this.iconPath = new vscode.ThemeIcon(icon || 'circle-large-outline');
  }
}
