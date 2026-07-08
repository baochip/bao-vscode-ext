import {
	getBootloaderSerialPort,
	getDefaultBaud,
	getMonitorDefaultPort,
	getRunSerialPort,
} from '@services/configService';
import type { ProjectMode } from '@services/projectModeService';
import * as vscode from 'vscode';

/** Build action label: cargo xtask in xous-core mode, cargo build out-of-tree. */
export function buildCommandLabel(mode: ProjectMode): string {
	return mode === 'xous-core'
		? vscode.l10n.t('Build (cargo xtask)')
		: vscode.l10n.t('Build (cargo build)');
}

/**
 * Tooltip for the monitor button and the sidebar monitor node: names the chosen mode, port, and
 * baud, or that the mode's port is not set. Shared so the status bar and the tree never drift.
 */
export function monitorTooltip(): string {
	const def = getMonitorDefaultPort(); // "run" | "bootloader"
	const port = def === 'run' ? getRunSerialPort() : getBootloaderSerialPort();
	if (port) {
		const modeLabel = def === 'run' ? vscode.l10n.t('Run') : vscode.l10n.t('Bootloader');
		return vscode.l10n.t(
			'Open monitor on {0} port {1} @ {2}',
			modeLabel,
			port,
			String(getDefaultBaud()),
		);
	}
	const modeWord = def === 'run' ? vscode.l10n.t('run mode') : vscode.l10n.t('bootloader mode');
	return vscode.l10n.t('Open monitor ({0} port not set)', modeWord);
}
