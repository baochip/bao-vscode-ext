import * as vscode from 'vscode';

type DocLink = { label: string; url: string; description?: string };

export class DocsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private links: DocLink[] = [
    { label: 'Coder\'s Guide to the Baochip 1x', url: 'https://baochip.github.io/baochip-1x/' },
    { label: 'The Xous Operating System', url: 'https://betrusted.io/xous-book/' },
    { label: 'Documentation for Baochip-1x SoC', url: 'https://ci.betrusted.io/bao1x/' },
    { label: 'Documentation for Cramium SoC (RISC-V Core Complex)', url: 'https://ci.betrusted.io/bao1x-cpu/' },
  ];

  refresh() { this._onDidChangeTreeData.fire(); }

  getTreeItem(el: vscode.TreeItem) { return el; }

  getChildren(): Thenable<vscode.TreeItem[]> {
    const items = this.links.map(link => {
      const item = new vscode.TreeItem(link.label, vscode.TreeItemCollapsibleState.None);
      item.tooltip = link.url;
      item.description = link.description;
      item.iconPath = new vscode.ThemeIcon('link-external');
      item.command = {
        title: vscode.l10n.t('button.open'),
        command: 'vscode.open',
        arguments: [vscode.Uri.parse(link.url)]
      };
      return item;
    });
    return Promise.resolve(items);
  }
}
