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
export function errorToast(msg: string) {
	log(`ERROR: ${msg}`);
	chan.show(true);
	vscode.window.showErrorMessage(msg);
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
