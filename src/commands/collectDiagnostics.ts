import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { buildDiagnosticsReport, copyToClipboard } from '@services/diagnosticsService';
import { appendSeparator, getBaochipChannel } from '@services/logService';
import * as vscode from 'vscode';

// The issue CHOOSER, not the bug form directly: it offers the bug template, the hardware and
// Xous contact links, and blank issues, so a "bug" that is really a board or Xous problem gets
// routed before the form railroads it. The bug form's intro references "the previous page",
// which assumes chooser arrival.
const NEW_ISSUE_URL = 'https://github.com/baochip/bao-vscode-ext/issues/new/choose';

function copiedMessage(): string {
	return vscode.l10n.t(
		"Diagnostics copied to the clipboard - paste them into the issue's Diagnostics field.",
	);
}

async function openIssueChooser(report: string): Promise<void> {
	await vscode.env.openExternal(vscode.Uri.parse(NEW_ISSUE_URL));
	// Deliberately NOT auto-copied: putting the report on the clipboard is the user's decision,
	// so the copy is offered rather than done.
	const copyLabel = vscode.l10n.t('Copy to Clipboard');
	const picked = await vscode.window.showInformationMessage(
		vscode.l10n.t('Add the diagnostics report to your issue?'),
		copyLabel,
	);
	if (picked === copyLabel) await copyToClipboard(report);
}

export function registerCollectDiagnostics() {
	return withCommand(Commands.collectDiagnostics, async () => {
		const report = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t('Baochip: Collecting diagnostics...'),
			},
			() => buildDiagnosticsReport(),
		);
		const chan = getBaochipChannel();
		appendSeparator(chan, 'Diagnostics');
		chan.appendLine(report);
		chan.show(true);

		const copyLabel = vscode.l10n.t('Copy to Clipboard');
		const issueLabel = vscode.l10n.t('Open GitHub Issue');
		const picked = await vscode.window.showInformationMessage(
			vscode.l10n.t(
				'Diagnostics collected - the report is shown in the Baochip output. Nothing has been sent.',
			),
			copyLabel,
			issueLabel,
		);
		if (picked === copyLabel) {
			await copyToClipboard(report);
			// Clicking a notification button dismisses the toast, so the issue button must be
			// re-offered - otherwise "copy, then open an issue" is impossible.
			const next = await vscode.window.showInformationMessage(copiedMessage(), issueLabel);
			if (next === issueLabel) {
				await vscode.env.openExternal(vscode.Uri.parse(NEW_ISSUE_URL));
			}
		} else if (picked === issueLabel) {
			await openIssueChooser(report);
		}
	});
}
