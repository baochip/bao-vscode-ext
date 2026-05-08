import * as vscode from 'vscode';

export const chan = vscode.window.createOutputChannel('Baochip');

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
