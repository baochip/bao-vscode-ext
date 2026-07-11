import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import * as vscode from 'vscode';

/**
 * Open the Settings editor pre-filtered to Baochip. Uses the workspace Settings editor when a
 * workspace is open, else the global one: openWorkspaceSettings rejects in an empty window (no
 * workspace to target), which would otherwise surface a spurious "command failed" toast.
 */
export async function openBaochipSettings(): Promise<void> {
	const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
	const command = hasWorkspace
		? 'workbench.action.openWorkspaceSettings'
		: 'workbench.action.openSettings';
	await vscode.commands.executeCommand(command, 'Baochip');
}

export function registerOpenSettings(): vscode.Disposable {
	return withCommand(Commands.openSettings, () => openBaochipSettings());
}
