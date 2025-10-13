import * as vscode from 'vscode';

export class BaoTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh() { this._onDidChangeTreeData.fire(undefined); }

  getTreeItem(el: TreeItem): vscode.TreeItem { return el; }

  getChildren(): Thenable<TreeItem[]> {
    const setPort = new TreeItem('Set monitor port', 'baochip.setMonitorPort');
    const monitor = new TreeItem('Monitor', 'baochip.openMonitor');
    return Promise.resolve([setPort, monitor]);
  }
}

class TreeItem extends vscode.TreeItem {
  constructor(label: string, commandId?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (commandId) {
      this.command = { title: label, command: commandId };
    }
    this.iconPath = new vscode.ThemeIcon('play');
  }
}
