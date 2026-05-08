import type {} from 'node:child_process'; // keep file type-safe; no direct spawn needed
import * as vscode from 'vscode';

export async function listPorts(
	runBao: (args: string[], cwd?: string, opts?: { capture?: boolean }) => Promise<string>,
	cwd?: string,
): Promise<string[]> {
	const out = await runBao(['ports'], cwd, { capture: true });
	// Support either plain lines or tab-separated fields (take the first column)
	return out
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => l.split('\t')[0])
		.filter(Boolean);
}

export async function waitForPort(
	runBao: (args: string[], cwd?: string, opts?: { capture?: boolean }) => Promise<string>,
	targetPort: string,
	opts?: { cwd?: string; timeoutMs?: number; intervalMs?: number },
): Promise<boolean> {
	const timeoutMs = opts?.timeoutMs ?? 20000;
	const intervalMs = opts?.intervalMs ?? 500;
	const start = Date.now();

	while (Date.now() - start < timeoutMs) {
		try {
			const ports = await listPorts(runBao, opts?.cwd);
			if (ports.includes(targetPort)) return true;
		} catch {
			// ignore transient errors and keep polling
		}
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return false;
}

/**
 * Show a confirmation modal, enumerate serial ports via bao, and present a quick pick.
 * Returns the chosen port string, or undefined if the user cancelled at any step.
 */
export async function pickSerialPort(
	runBao: (args: string[], cwd?: string, opts?: { capture?: boolean }) => Promise<string>,
	cwd: string,
	opts: {
		confirmTitle: string;
		confirmDetail: string;
		placeholder: string;
	},
): Promise<string | undefined> {
	const okLabel = vscode.l10n.t('OK');
	const clicked = await vscode.window.showInformationMessage(
		opts.confirmTitle,
		{ modal: true, detail: opts.confirmDetail },
		okLabel,
	);
	if (clicked !== okLabel) return undefined;

	const lines = await runBao(['ports'], cwd, { capture: true }).catch((err: unknown) => {
		vscode.window.showErrorMessage(
			vscode.l10n.t('Could not list ports: {0}', (err as Error)?.message || String(err)),
		);
		return '';
	});

	const items = (lines || '')
		.split(/\r?\n/)
		.map((s) => s.trim())
		.filter(Boolean)
		.map((line) => {
			const [port, desc] = line.split('\t');
			return { label: port, description: desc || undefined };
		});

	if (items.length === 0) {
		vscode.window.showWarningMessage(vscode.l10n.t('No serial ports found.'));
		return undefined;
	}

	const picked = await vscode.window.showQuickPick(items, { placeHolder: opts.placeholder });
	return picked?.label;
}
