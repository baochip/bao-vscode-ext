import type {} from 'node:child_process'; // keep file type-safe; no direct spawn needed
import { getBootloaderSerialPort, getRunSerialPort } from '@services/configService';
import { toMessage } from '@util/error';
import { pollUntil } from '@util/poll';
import * as vscode from 'vscode';

type RunBao = (
	args: string[],
	cwd?: string,
	opts?: { capture?: boolean; quiet?: boolean },
) => Promise<string>;

/** Ensure a serial port is set for the given mode: prompt to pick one and re-check. Returns the port or undefined. */
export async function ensureSerialPort(mode: 'run' | 'bootloader'): Promise<string | undefined> {
	const read = () => (mode === 'run' ? getRunSerialPort() : getBootloaderSerialPort());
	const existing = read();
	if (existing) return existing;

	const friendly = mode === 'run' ? vscode.l10n.t('run mode') : vscode.l10n.t('bootloader mode');
	vscode.window.showInformationMessage(
		vscode.l10n.t('No {0} serial port set. Pick one first.', friendly),
	);
	await vscode.commands.executeCommand(
		mode === 'run' ? 'baochip.setRunSerialPort' : 'baochip.setBootloaderSerialPort',
	);
	return read();
}

export async function listPorts(
	runBao: RunBao,
	cwd?: string,
	opts?: { quiet?: boolean },
): Promise<string[]> {
	const out = await runBao(['ports'], cwd, { capture: true, quiet: opts?.quiet });
	// Support either plain lines or tab-separated fields (take the first column)
	return out
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => l.split('\t')[0])
		.filter(Boolean);
}

export async function waitForPort(
	runBao: RunBao,
	targetPort: string,
	opts?: {
		cwd?: string;
		timeoutMs?: number;
		intervalMs?: number;
		token?: vscode.CancellationToken;
	},
): Promise<boolean> {
	// A persistent probe failure means bao.py itself is broken (not just "port not ready yet"),
	// so pollUntil bails after a few consecutive errors instead of spinning the full timeout.
	let lastError: unknown;
	const result = await pollUntil(
		async () => {
			try {
				const ports = await listPorts(runBao, opts?.cwd, { quiet: true });
				return ports.includes(targetPort);
			} catch (e: unknown) {
				lastError = e;
				throw e;
			}
		},
		{
			timeoutMs: opts?.timeoutMs ?? 20000,
			intervalMs: opts?.intervalMs ?? 500,
			maxErrors: 3,
			now: Date.now,
			sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
			isCancelled: () => opts?.token?.isCancellationRequested ?? false,
		},
	);
	if (result === 'error') {
		const msg = toMessage(lastError);
		vscode.window.showErrorMessage(vscode.l10n.t('Could not list ports: {0}', msg));
	}
	return result === 'found';
}

/**
 * Show a confirmation modal, enumerate serial ports via bao, and present a quick pick.
 * Returns the chosen port string, or undefined if the user cancelled at any step.
 */
export async function pickSerialPort(
	runBao: RunBao,
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
