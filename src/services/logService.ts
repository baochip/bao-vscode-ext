import * as vscode from 'vscode';

const chan = vscode.window.createOutputChannel('Baochip');

export function log(msg: string) {
	const stamp = new Date().toISOString();
	chan.appendLine(`[${stamp}] ${msg}`);
}
export function info(msg: string) {
	log(`INFO: ${msg}`);
	vscode.window.showInformationMessage(msg);
}
export function warn(msg: string) {
	log(`WARN: ${msg}`);
	vscode.window.showWarningMessage(msg);
}
export type ToastAction = { label: string; run: () => unknown };

/** Show an error toast with action buttons, running the one the user clicks; does not log. */
export function showErrorWithActions(msg: string, actions: ToastAction[]): void {
	// Promise.resolve tolerates a non-thenable return (e.g. a bare test stub).
	void Promise.resolve(vscode.window.showErrorMessage(msg, ...actions.map((a) => a.label))).then(
		(picked) => {
			actions.find((a) => a.label === picked)?.run();
		},
	);
}

/** Toast action that reveals the shared Baochip output channel without taking focus. */
export function showOutputAction(): ToastAction {
	return { label: vscode.l10n.t('Show Output'), run: () => chan.show(true) };
}

export function errorToast(msg: string, actions: ToastAction[] = []) {
	log(`ERROR: ${msg}`);
	showErrorWithActions(msg, [...actions, showOutputAction()]);
}

/** The single Baochip output channel - build, flash, boot, and all diagnostics stream here. */
export function getBaochipChannel(): vscode.OutputChannel {
	return chan;
}

/** Labeled divider so consecutive operations are delimited in the shared channel. */
export function appendSeparator(channel: vscode.OutputChannel, label: string): void {
	channel.appendLine('');
	channel.appendLine(`===== ${label} =====`);
}
