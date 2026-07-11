import { Commands } from '@commands/commandIds';
import { getMonitorDefaultPort } from '@services/configService';
import { getProjectMode } from '@services/projectModeService';
import { buildCommandLabel, monitorTooltip } from '@views/uiLabels';
import * as vscode from 'vscode';

export class BaoTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	// Section headers carry stable ids so VS Code persists each user's expand/collapse state.
	private setupSection = new SectionItem('baochip.section.setup', vscode.l10n.t('Setup'));
	private projectSection = new SectionItem('baochip.section.project', vscode.l10n.t('Project'));
	private buildRunSection = new SectionItem(
		'baochip.section.buildRun',
		vscode.l10n.t('Build & Run'),
	);

	// A plain leaf: a collapsible item would make VS Code reserve twisty space for the whole
	// section, pushing Build & Run's items out of alignment with the other sections.
	private monitorNode = new TreeItem(vscode.l10n.t('Monitor'), Commands.openMonitor, 'vm');

	refresh() {
		this._onDidChangeTreeData.fire(undefined);
	}

	dispose() {
		this._onDidChangeTreeData.dispose();
	}

	getTreeItem(el: vscode.TreeItem) {
		// Dynamically update tooltip to show the chosen mode/port/baud
		if (el === this.monitorNode) {
			el.tooltip = monitorTooltip();
		}
		return el;
	}

	getChildren(element?: vscode.TreeItem) {
		if (!element) {
			// Without a folder there is nothing to build or configure: yield no items so the
			// viewsWelcome contribution renders its get-started content instead.
			if ((vscode.workspace.workspaceFolders ?? []).length === 0) {
				return Promise.resolve([]);
			}
			return Promise.resolve([this.setupSection, this.projectSection, this.buildRunSection]);
		}

		if (element === this.setupSection) {
			const def = getMonitorDefaultPort();
			const defLabel = def === 'run' ? vscode.l10n.t('Run') : vscode.l10n.t('Bootloader');
			return Promise.resolve([
				new TreeItem(
					vscode.l10n.t('Set bootloader mode serial port'),
					Commands.setBootloaderSerialPort,
					'plug',
				),
				new TreeItem(vscode.l10n.t('Set run mode serial port'), Commands.setRunSerialPort, 'plug'),
				new TreeItem(
					vscode.l10n.t('Default monitor: {0}', defLabel),
					Commands.setMonitorDefaultPort,
					'gear',
				),
				new TreeItem(vscode.l10n.t('Set baochip location'), Commands.setFlashLocation, 'chip'),
				new TreeItem(vscode.l10n.t('Select build target'), Commands.selectBuildTarget, 'target'),
				new TreeItem(
					vscode.l10n.t('Build mode: {0}', getProjectMode()),
					Commands.setBuildMode,
					'circuit-board',
				),
			]);
		}

		if (element === this.projectSection) {
			return Promise.resolve([
				new TreeItem(vscode.l10n.t('New app'), Commands.createApp, 'add'),
				...(getProjectMode() === 'xous-core'
					? [new TreeItem(vscode.l10n.t('Select app'), Commands.selectApp, 'search')]
					: []),
			]);
		}

		if (element === this.buildRunSection) {
			return Promise.resolve([
				new TreeItem(vscode.l10n.t('Clean (cargo clean)'), Commands.clean, 'trash'),
				new TreeItem(buildCommandLabel(getProjectMode()), Commands.build, 'tools'),
				new TreeItem(vscode.l10n.t('Flash device'), Commands.flash, 'rocket'),
				this.monitorNode,
				new TreeItem(
					vscode.l10n.t('Build • Flash • Monitor'),
					Commands.buildFlashMonitor,
					'rocket',
				),
			]);
		}

		return Promise.resolve([]);
	}
}

/** Collapsible header with no icon and no command; groups the action items beneath it. */
class SectionItem extends vscode.TreeItem {
	constructor(id: string, label: string) {
		super(label, vscode.TreeItemCollapsibleState.Expanded);
		this.id = id;
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
