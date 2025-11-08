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
    vscode.l10n.t('tree.monitor'),
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
      const modeLabel = def === 'run' ? vscode.l10n.t('label.run') : vscode.l10n.t('label.bootloader');
      if (port) {
        el.tooltip = vscode.l10n.t('tree.monitorTooltipSet', modeLabel, port, String(baud));
      } else {
        // lower-cased mode
        const modeWord = def === 'run' ? vscode.l10n.t('mode.run') : vscode.l10n.t('mode.bootloader');
        el.tooltip = vscode.l10n.t('tree.monitorTooltipUnset', modeWord);
      }
    }
    return el;
  }

  getChildren(element?: TreeItem) {
    if (!element) {
      const welcome = new TreeItem(vscode.l10n.t('tree.welcome'), 'baochip.openWelcome', 'home');
      const setBootloaderPort = new TreeItem(vscode.l10n.t('tree.setBootloaderPort'), 'baochip.setBootloaderSerialPort', 'plug');
      const setRunPort = new TreeItem(vscode.l10n.t('tree.setRunPort'), 'baochip.setRunSerialPort', 'plug');
      const setFlashLoc = new TreeItem(vscode.l10n.t('tree.setFlashLoc'), 'baochip.setFlashLocation', 'chip');
      const target   = new TreeItem(vscode.l10n.t('tree.selectBuildTarget'), 'baochip.selectBuildTarget', 'target');
      const newApp   = new TreeItem(vscode.l10n.t('tree.newApp'), 'baochip.createApp', 'add');
      const selectApp = new TreeItem(vscode.l10n.t('tree.selectApp'), 'baochip.selectApp', 'search');
      const clean    = new TreeItem(vscode.l10n.t('tree.cleanCargo'), 'baochip.clean', 'trash');
      const build    = new TreeItem(vscode.l10n.t('tree.buildXtask'), 'baochip.build', 'tools');
      const flash    = new TreeItem(vscode.l10n.t('tree.flashDevice'), 'baochip.flash', 'rocket');
      const bfm      = new TreeItem(vscode.l10n.t('tree.buildFlashMonitor'), 'baochip.buildFlashMonitor', 'rocket');
      const settings = new TreeItem(vscode.l10n.t('tree.openSettings'), 'baochip.openSettings', 'gear');

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
      const label = def === 'run' ? vscode.l10n.t('label.run') : vscode.l10n.t('label.bootloader');
      const defaultMonChild = new TreeItem(
        vscode.l10n.t('tree.defaultMonitorLabel', label),
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
