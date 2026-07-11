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
						'Run mode: if you still see the "BAOCHIP" drive, press PROG on the board',
					),
					placeholder: vscode.l10n.t('Select run mode (firmware) serial port'),
				}
			: {
					title: vscode.l10n.t(
						'Bootloader mode: press RESET if you do not see the "BAOCHIP" drive',
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

/**
 * Live serial-port QuickPick: shows immediately (busy while enumerating via bao), keeps the
 * board-mode guidance in the title, re-enumerates from the refresh button or by accepting the
 * no-ports hint row, and highlights a lone port so Enter accepts it. Resolves to the chosen
 * port, or undefined when the user dismisses or a listing fails (one error toast).
 */
async function pickSerialPort(
	runBao: RunBao,
	cwd: string,
	opts: { title: string; placeholder: string },
): Promise<string | undefined> {
	const qp = vscode.window.createQuickPick<PortPickItem>();
	qp.title = opts.title;
	qp.placeholder = opts.placeholder;
	// The user is physically handling the board (plugging in, pressing PROG/RESET), so focus
	// will leave VS Code; the picker must not dismiss itself when that happens.
	qp.ignoreFocusOut = true;
	const refreshButton: vscode.QuickInputButton = {
		iconPath: new vscode.ThemeIcon('refresh'),
		tooltip: vscode.l10n.t('Refresh ports'),
	};
	qp.buttons = [refreshButton];

	// quiet: this function shows the single failure toast itself. A listing failure closes the
	// picker, kept distinct from a successful empty result (the no-ports hint row below).
	const refresh = async () => {
		if (qp.busy) return; // ignore re-triggers while a listing is already running
		qp.busy = true;
		let lines: string;
		try {
			lines = await runBao(['ports'], cwd, { capture: true, quiet: true });
		} catch (err: unknown) {
			errorToast(vscode.l10n.t('Could not list ports: {0}', toMessage(err)));
			qp.hide();
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

		qp.items = items.length
			? items
			: [
					{
						label: `$(warning) ${vscode.l10n.t('No serial ports found.')}`,
						detail: vscode.l10n.t('Plug the board in (or switch its mode), then refresh.'),
						alwaysShow: true,
					},
				];
		// A lone port is almost always the right one: highlight it so a bare Enter accepts it
		// (but never auto-accept - the one visible port can still be the wrong-mode port).
		if (items.length === 1) qp.activeItems = [items[0]];
		qp.busy = false;
	};

	return new Promise<string | undefined>((resolve) => {
		let picked: string | undefined;
		qp.onDidTriggerButton((b) => {
			if (b === refreshButton) void refresh();
		});
		qp.onDidAccept(() => {
			const item = qp.selectedItems[0];
			if (!item) return;
			if (!item.port) {
				void refresh(); // accepting the no-ports hint is the retry gesture
				return;
			}
			picked = item.port;
			qp.hide();
		});
		qp.onDidHide(() => {
			qp.dispose();
			resolve(picked);
		});
		qp.show();
		void refresh();
	});
}
