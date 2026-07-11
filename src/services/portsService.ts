import { runBaoCmd } from '@services/baoRunnerService';
import {
	getBootloaderSerialPort,
	getRunSerialPort,
	setBootloaderSerialPort,
	setRunSerialPort,
} from '@services/configService';
import { errorToast } from '@services/logService';
import { getGlobalVenvRoot } from '@services/uvService';
import { toMessage } from '@util/error';
import { type PollResult, pollUntil } from '@util/poll';
import { parsePortsOutput } from '@util/ports';
import * as vscode from 'vscode';

type RunBao = (
	args: string[],
	cwd?: string,
	opts?: { capture?: boolean; quiet?: boolean; token?: vscode.CancellationToken },
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
	await promptAndSaveSerialPort(mode);
	return read();
}

/** Prompt the user to pick a serial port for the given mode, persist it, and return it (or undefined if cancelled). */
export async function promptAndSaveSerialPort(
	mode: 'run' | 'bootloader',
): Promise<string | undefined> {
	const opts =
		mode === 'run'
			? {
					title: vscode.l10n.t(
						'Put the board in RUN mode - press PROG if you still see the "BAOCHIP" drive',
					),
					placeholder: vscode.l10n.t('Select run mode (firmware) serial port'),
				}
			: {
					title: vscode.l10n.t(
						'Put the board in BOOTLOADER mode - press RESET if you do not see the "BAOCHIP" drive',
					),
					placeholder: vscode.l10n.t('Select bootloader (drive mode) serial port'),
				};

	const port = await pickSerialPort(runBaoCmd, getGlobalVenvRoot(), opts);
	if (!port) return undefined;

	if (mode === 'run') {
		await setRunSerialPort(port);
		vscode.window.showInformationMessage(vscode.l10n.t('Run mode serial port set to: {0}', port));
	} else {
		await setBootloaderSerialPort(port);
		vscode.window.showInformationMessage(
			vscode.l10n.t('Bootloader (drive mode) serial port set to: {0}', port),
		);
	}
	return port;
}

async function listPorts(
	runBao: RunBao,
	cwd?: string,
	opts?: { quiet?: boolean; token?: vscode.CancellationToken },
): Promise<string[]> {
	const out = await runBao(['ports'], cwd, {
		capture: true,
		quiet: opts?.quiet,
		token: opts?.token,
	});
	return parsePortsOutput(out);
}

/**
 * Poll for `targetPort` to appear. Returns the poll outcome so callers can distinguish a genuine
 * timeout (bao.py works, port just not ready - retrying may still help) from a probe 'error'
 * (bao.py itself is broken - already surfaced here, so the caller should not retry blindly).
 */
export async function waitForPort(
	runBao: RunBao,
	targetPort: string,
	opts?: {
		cwd?: string;
		timeoutMs?: number;
		intervalMs?: number;
		token?: vscode.CancellationToken;
	},
): Promise<PollResult> {
	// A persistent probe failure means bao.py itself is broken (not just "port not ready yet"),
	// so pollUntil bails after a few consecutive errors instead of spinning the full timeout.
	let lastError: unknown;
	const result = await pollUntil(
		async () => {
			try {
				const ports = await listPorts(runBao, opts?.cwd, { quiet: true, token: opts?.token });
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
		errorToast(vscode.l10n.t('Could not list ports: {0}', msg));
	}
	return result;
}

type PortPickItem = vscode.QuickPickItem & { port?: string };

const PICKER_POLL_INTERVAL_MS = 2000;

/**
 * Live serial-port QuickPick: shows immediately, keeps the board-mode instruction in the title,
 * and re-enumerates on its own every couple of seconds while open - the user flips the board's
 * mode mid-pick and the OS takes a moment to re-enumerate, so the list must follow with no
 * manual action. The title-bar refresh button and accepting the no-ports hint re-list right
 * away. A lone port is highlighted so Enter accepts it. Resolves to the chosen port, or
 * undefined when the user dismisses or a listing fails (one error toast).
 */
async function pickSerialPort(
	runBao: RunBao,
	cwd: string,
	opts: { title: string; placeholder: string },
): Promise<string | undefined> {
	const qp = vscode.window.createQuickPick<PortPickItem>();
	qp.title = opts.title;
	qp.placeholder = opts.placeholder;
	// Standard dismissal (Escape and click-away) deliberately stays enabled: pressing the board's
	// buttons does not move window focus, so there is nothing to protect against, and a picker
	// that only Escape can close feels like a trap.
	const refreshButton: vscode.QuickInputButton = {
		iconPath: new vscode.ThemeIcon('refresh'),
		tooltip: vscode.l10n.t('Refresh ports'),
	};
	qp.buttons = [refreshButton];

	let refreshing = false;
	let refreshQueued = false;
	let lastListing: string | null = null;

	// quiet: this function shows the single failure toast itself. A listing failure closes the
	// picker, kept distinct from a successful empty result (the no-ports hint row below).
	// A request that arrives mid-enumeration is queued, never dropped - a dropped click on the
	// refresh button reads as "the button is broken". Background polls skip the busy spinner so
	// the picker does not blink every interval.
	const refresh = async (showBusy: boolean) => {
		if (refreshing) {
			refreshQueued = true;
			return;
		}
		refreshing = true;
		if (showBusy) qp.busy = true;
		try {
			do {
				refreshQueued = false;
				let lines: string;
				try {
					lines = await runBao(['ports'], cwd, { capture: true, quiet: true });
				} catch (err: unknown) {
					// A user-initiated refresh surfaces the failure and closes the picker; a background
					// poll stays silent and simply tries again next tick - a transient enumeration
					// hiccup must not yank the picker out from under the user.
					if (showBusy) {
						errorToast(vscode.l10n.t('Could not list ports: {0}', toMessage(err)));
						qp.hide();
					}
					return;
				}

				const items: PortPickItem[] = lines
					.split(/\r?\n/)
					.map((s) => s.trim())
					.filter(Boolean)
					.map((line) => {
						const [port, desc] = line.split('\t');
						return { label: port, description: desc || undefined, port };
					});

				// Only touch the UI when the listing actually changed, so polling never causes
				// flicker or resets the user's filter text and highlight.
				const listing = items.map((i) => `${i.label}\t${i.description ?? ''}`).join('\n');
				if (listing !== lastListing) {
					lastListing = listing;
					qp.items = items.length
						? items
						: [
								{
									label: `$(warning) ${vscode.l10n.t('No serial ports found.')}`,
									detail: vscode.l10n.t(
										'Plug the board in or switch its mode - the list refreshes automatically.',
									),
									alwaysShow: true,
								},
							];
					// A lone port is almost always the right one: highlight it so a bare Enter accepts
					// it (but never auto-accept - the one visible port can still be the wrong-mode port).
					if (items.length === 1) qp.activeItems = [items[0]];
				}
			} while (refreshQueued);
		} finally {
			refreshing = false;
			qp.busy = false;
		}
	};

	const poller = setInterval(() => void refresh(false), PICKER_POLL_INTERVAL_MS);

	return new Promise<string | undefined>((resolve) => {
		let picked: string | undefined;
		qp.onDidTriggerButton((b) => {
			if (b === refreshButton) void refresh(true);
		});
		qp.onDidAccept(() => {
			const item = qp.selectedItems[0];
			if (!item) return;
			if (!item.port) {
				void refresh(true); // accepting the no-ports hint is the retry gesture
				return;
			}
			picked = item.port;
			qp.hide();
		});
		qp.onDidHide(() => {
			clearInterval(poller);
			qp.dispose();
			resolve(picked);
		});
		qp.show();
		void refresh(true);
	});
}

/**
 * One quiet enumeration: is `port` currently present? Returns null when the listing itself
 * fails, so callers can treat "could not determine" differently from a definite absence.
 */
export async function isPortPresent(port: string): Promise<boolean | null> {
	try {
		const ports = await listPorts(runBaoCmd, getGlobalVenvRoot(), { quiet: true });
		return ports.includes(port);
	} catch {
		return null;
	}
}

/**
 * Warn that `port` (for `mode`) is not present and offer to pick a replacement with the live
 * picker. Returns the newly saved port, or undefined if the user dismissed either step.
 */
export async function offerRepickMissingPort(
	mode: 'run' | 'bootloader',
	port: string,
): Promise<string | undefined> {
	const friendly = mode === 'run' ? vscode.l10n.t('run mode') : vscode.l10n.t('bootloader mode');
	const pickLabel = vscode.l10n.t('Pick a different port');
	const clicked = await vscode.window.showWarningMessage(
		vscode.l10n.t('The {0} serial port {1} is not present.', friendly, port),
		pickLabel,
	);
	if (clicked !== pickLabel) return undefined;
	return promptAndSaveSerialPort(mode);
}
