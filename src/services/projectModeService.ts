import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export type ProjectMode = 'xous-core' | 'out-of-tree';

/**
 * Scans open workspace folders for an apps-dabao/ directory.
 * Returns the root path of the first match, or undefined if not found.
 */
export function findXousCoreInWorkspace(): string | undefined {
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		const candidate = path.join(folder.uri.fsPath, 'apps-dabao');
		if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
			return folder.uri.fsPath;
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
