import * as fs from 'node:fs';
import * as path from 'node:path';
import { ALL_APPS_DIRS } from '@constants';
import { getBuildMode } from '@services/configService';
import { isDirectory } from '@util/fsUtil';
import * as vscode from 'vscode';

export type ProjectMode = 'xous-core' | 'out-of-tree';

/**
 * Scans open workspace folders for any known apps directory (apps-dabao, apps-baosec, etc.).
 * Returns the root path of the first match, or undefined if not found.
 */
export function findXousCoreInWorkspace(): string | undefined {
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		for (const appsDir of ALL_APPS_DIRS) {
			const candidate = path.join(folder.uri.fsPath, appsDir);
			if (isDirectory(candidate)) {
				return folder.uri.fsPath;
			}
		}
	}
	return undefined;
}

/**
 * Returns the root path of the first workspace folder for out-of-tree mode,
 * or shows an error and returns undefined if no folder is open.
 */
export function getOutOfTreeRoot(): string | undefined {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		vscode.window.showErrorMessage(vscode.l10n.t('No workspace folder open.'));
		return undefined;
	}
	return folder.uri.fsPath;
}

/**
 * Returns the active project mode.
 * Respects the baochip.buildMode setting; falls back to auto-detection
 * based on whether any workspace folder contains an apps-dabao/ directory.
 */
export function getProjectMode(): ProjectMode {
	const setting = getBuildMode();
	if (setting === 'xous-core') return 'xous-core';
	if (setting === 'out-of-tree') return 'out-of-tree';
	return findXousCoreInWorkspace() !== undefined ? 'xous-core' : 'out-of-tree';
}

// Settings whose presence at workspace scope marks deliberate Baochip use of that workspace.
const WORKSPACE_INTENT_KEYS = [
	'baochip.buildMode',
	'baochip.buildTarget',
	'baochip.xousCorePath',
	'baochip.xousAppName',
	'baochip.serialPortRun',
	'baochip.serialPortBootloader',
	'baochip.flashLocation',
];

/**
 * Is the current workspace Baochip-related? True when an xous-core checkout is open, any
 * Baochip setting was written at workspace scope (explicit intent), or a folder holds a
 * Cargo.toml that mentions xous (every scaffolded out-of-tree project does). Gates the
 * ambient UI - the status bar row and the welcome auto-open - so unrelated projects are not
 * decorated; the sidebar, commands, and keybindings stay available everywhere.
 */
export function isBaochipWorkspace(): boolean {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length === 0) return false;

	if (findXousCoreInWorkspace() !== undefined) return true;

	const cfg = vscode.workspace.getConfiguration();
	for (const key of WORKSPACE_INTENT_KEYS) {
		const ins = cfg.inspect(key);
		if (ins && (ins.workspaceValue !== undefined || ins.workspaceFolderValue !== undefined)) {
			return true;
		}
	}

	for (const folder of folders) {
		const cargo = path.join(folder.uri.fsPath, 'Cargo.toml');
		try {
			if (fs.existsSync(cargo) && fs.readFileSync(cargo, 'utf8').includes('xous')) return true;
		} catch {
			// an unreadable Cargo.toml is not a relevance marker
		}
	}
	return false;
}
