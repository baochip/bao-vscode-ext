import { Commands } from '@commands/commandIds';
import {
	getBootloaderSerialPort,
	getDefaultBaud,
	getMonitorDefaultPort,
	getRunSerialPort,
} from '@services/configService';
import { getProjectMode } from '@services/projectModeService';
import * as vscode from 'vscode';

export class BaoTreeProvider implements vscode.TreeDataProvider<TreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private monitorNode = new TreeItem(
		vscode.l10n.t('Monitor'),
		Commands.openMonitor,
		'vm',
		vscode.TreeItemCollapsibleState.Collapsed,
	);

	refresh() {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(el: TreeItem) {
		// Dynamically update tooltip to show the chosen mode/port/baud
		if (el === this.monitorNode) {
			const def = getMonitorDefaultPort(); // "run" | "bootloader"
			const port = def === 'run' ? getRunSerialPort() : getBootloaderSerialPort();
			const baud = getDefaultBaud();
			const modeLabel = def === 'run' ? vscode.l10n.t('Run') : vscode.l10n.t('Bootloader');
			if (port) {
				el.tooltip = vscode.l10n.t(
					'Open monitor on {0} port {1} @ {2}',
					modeLabel,
					port,
					String(baud),
				);
			} else {
				// lower-cased mode
				const modeWord =
					def === 'run' ? vscode.l10n.t('run mode') : vscode.l10n.t('bootloader mode');
				el.tooltip = vscode.l10n.t('Open monitor ({0} port not set)', modeWord);
			}
		}
		return el;
	}

	getChildren(element?: TreeItem) {
		if (!element) {
			const setBootloaderPort = new TreeItem(
				vscode.l10n.t('Set bootloader mode serial port'),
				Commands.setBootloaderSerialPort,
				'plug',
			);
			const setRunPort = new TreeItem(
				vscode.l10n.t('Set run mode serial port'),
				Commands.setRunSerialPort,
				'plug',
			);
			const setFlashLoc = new TreeItem(
				vscode.l10n.t('Set baochip location'),
				Commands.setFlashLocation,
				'chip',
			);
			const target = new TreeItem(
				vscode.l10n.t('Select build target'),
				Commands.selectBuildTarget,
				'target',
			);
			const mode = getProjectMode();
			const modeItem = new TreeItem(
				vscode.l10n.t('Build mode: {0}', mode),
				Commands.setBuildMode,
				'circuit-board',
			);
			const newApp = new TreeItem(vscode.l10n.t('New app'), Commands.createApp, 'add');
			const selectApp = new TreeItem(vscode.l10n.t('Select app'), Commands.selectApp, 'search');
			const clean = new TreeItem(vscode.l10n.t('Clean (cargo clean)'), Commands.clean, 'trash');
			const build = new TreeItem(
				mode === 'xous-core'
					? vscode.l10n.t('Build (cargo xtask)')
					: vscode.l10n.t('Build (cargo build)'),
				Commands.build,
				'tools',
			);
			const flash = new TreeItem(vscode.l10n.t('Flash device'), Commands.flash, 'rocket');
			const bfm = new TreeItem(
				vscode.l10n.t('Build - Flash - Monitor'),
				Commands.buildFlashMonitor,
				'rocket',
			);
			const settings = new TreeItem(vscode.l10n.t('Open Settings'), Commands.openSettings, 'gear');

			const items = [
				setBootloaderPort,
				setRunPort,
				setFlashLoc,
				target,
				modeItem,
				newApp,
				...(mode === 'xous-core' ? [selectApp] : []),
				clean,
				build,
				flash,
				this.monitorNode,
				bfm,
				settings,
			];
			return Promise.resolve(items);
		}

		if (element === this.monitorNode) {
			const def = getMonitorDefaultPort();
			const label = def === 'run' ? vscode.l10n.t('Run') : vscode.l10n.t('Bootloader');
			const defaultMonChild = new TreeItem(
				vscode.l10n.t('Default monitor: {0}', label),
				Commands.setMonitorDefaultPort,
				'gear',
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
		collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
	) {
		super(label, collapsibleState);
		if (commandId) this.command = { title: label, command: commandId };
		this.iconPath = new vscode.ThemeIcon(icon || 'circle-large-outline');
	}
}
