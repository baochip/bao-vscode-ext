import * as fs from 'node:fs';
import * as path from 'node:path';
import { ALL_APPS_DIRS } from '@constants';
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
			if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
				return folder.uri.fsPath;
			}
		}
	}
	return undefined;
}

/**
 * Returns the active project mode.
 * Respects the baochip.buildMode setting; falls back to auto-detection
 * based on whether any workspace folder contains an apps-dabao/ directory.
 */
export function getProjectMode(): ProjectMode {
	const setting = vscode.workspace.getConfiguration('').get<string>('baochip.buildMode') ?? 'auto';
	if (setting === 'xous-core') return 'xous-core';
	if (setting === 'out-of-tree') return 'out-of-tree';
	return findXousCoreInWorkspace() !== undefined ? 'xous-core' : 'out-of-tree';
}
