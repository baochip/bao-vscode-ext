import { buildBaoArgs, ensureBaoDepsQuietly, resolveBaoPy } from '@services/baoRunnerService';
import { getDefaultBaud, getRunSerialPort } from '@services/configService';
import { appendSeparator, errorToast, getBaochipChannel } from '@services/logService';
import { ensureSerialPort, isPortPresent } from '@services/portsService';
import { describeRunFailure, runProcess } from '@services/procService';
import { getBaoRunner, getGlobalVenvRoot, uvEnv } from '@services/uvService';
import { pollUntil } from '@util/poll';
import * as vscode from 'vscode';

const BOOT_ATTEMPTS = 3;
/** Wait for the bootloader port to disappear before calling an attempt lost. */
const PORT_DROP_TIMEOUT_MS = 3000;
/** Each probe spawns a bao process, so poll at the same cadence as the monitor's port wait. */
const PORT_DROP_INTERVAL_MS = 500;

/** Send the boot command once. True when bao.py wrote it to the port. */
async function sendBootOnce(port: string, baud: number): Promise<boolean> {
	const bao = resolveBaoPy();
	const root = getGlobalVenvRoot();
	const chan = getBaochipChannel();

	const { cmd, args } = await getBaoRunner(); // e.g., uv + ['run','python']
	const fullArgs = buildBaoArgs(args, bao, 'boot', port, baud);

	const r = await runProcess(cmd, fullArgs, {
		cwd: root,
		env: uvEnv(),
		onStdout: (s) => chan.append(s),
		onStderr: (s) => chan.append(s),
	});
	if (!r.error && r.code === 0) return true;

	const msg = describeRunFailure(r).slice(0, 300);
	errorToast(vscode.l10n.t('Boot command failed: {0}', msg)); // toast + central Baochip log
	chan.appendLine(`[bao] ${vscode.l10n.t('Boot command failed: {0}', msg)}`);
	return false;
}

/** Did the device leave bootloader mode? 'unknown' when the port list cannot be read. */
async function bootloaderPortDropped(port: string): Promise<'gone' | 'present' | 'unknown'> {
	let probeFailed = false;
	const result = await pollUntil(
		async () => {
			const present = await isPortPresent(port);
			if (present === null) {
				probeFailed = true;
				throw new Error('port list unavailable');
			}
			return !present;
		},
		{
			timeoutMs: PORT_DROP_TIMEOUT_MS,
			intervalMs: PORT_DROP_INTERVAL_MS,
			maxErrors: 2,
			now: Date.now,
			sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		},
	);
	if (result === 'found') return 'gone';
	return probeFailed && result === 'error' ? 'unknown' : 'present';
}

export async function sendBoot(): Promise<boolean> {
	// Ensure bootloader port is set; if not, prompt and re-check.
	const port = await ensureSerialPort('bootloader');
	// Silent abort (like the monitor): ensureSerialPort already surfaces a listing failure, and a
	// cancelled pick needs no extra nag - this also avoids an error+warning double-notification.
	if (!port) return false;

	const baud = getDefaultBaud();
	const chan = getBaochipChannel();
	appendSeparator(chan, 'Boot');
	chan.show(true);
	chan.appendLine(`[bao] ${vscode.l10n.t("Sending 'boot' to {0} @ {1}...", port, baud)}`);

	// Boot runs bao.py directly (not via runBaoCmd), so the venv and its deps must be
	// prepared here or a fresh install hits ModuleNotFoundError.
	await ensureBaoDepsQuietly();

	// A booted device drops its bootloader port, so a port still there means the command was
	// missed. Ports sharing a name make presence meaningless, so only then is one send all we do.
	const verifiable = getRunSerialPort() !== port;

	for (let attempt = 1; attempt <= BOOT_ATTEMPTS; attempt++) {
		if (!(await sendBootOnce(port, baud))) return false;

		const dropped = verifiable ? await bootloaderPortDropped(port) : 'unverified';
		if (dropped === 'unknown') {
			chan.appendLine(`[bao] ${vscode.l10n.t('Could not check whether {0} disappeared.', port)}`);
		}
		if (dropped !== 'present') {
			chan.appendLine(`[bao] ${vscode.l10n.t('boot command succeeded.')}`);
			return true;
		}

		chan.appendLine(
			`[bao] ${vscode.l10n.t('{0} is still present after boot (attempt {1} of {2}).', port, attempt, BOOT_ATTEMPTS)}`,
		);
	}

	// Every send worked, so this is not a command failure - the device never left bootloader
	// mode. Report it and carry on rather than failing the pipeline.
	vscode.window.showWarningMessage(
		vscode.l10n.t(
			'Baochip: sent boot {0} times but {1} is still present. The board may not have restarted - try the PROG button.',
			BOOT_ATTEMPTS,
			port,
		),
	);
	return true;
}
