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

const _channels = new Map<string, vscode.OutputChannel>();
/** Lazily create (and cache) a named output channel. */
export function getChannel(name: string): vscode.OutputChannel {
	let c = _channels.get(name);
	if (!c) {
		c = vscode.window.createOutputChannel(name);
		_channels.set(name, c);
	}
	return c;
}

/** The shared Bao Build output channel (build, UF2 convert, and toolchain steps stream here). */
export function getBuildChannel(): vscode.OutputChannel {
	return getChannel(vscode.l10n.t('Bao Build'));
}
