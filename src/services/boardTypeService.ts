import { runBaoCmd } from '@services/baoRunnerService';
import { getBootloaderSerialPort, getDefaultBaud } from '@services/configService';

/** The line bao.py prints on success: "[bao] boardtype: dabao". */
const REPLY_RE = /boardtype:\s*(\w+)/i;

export function parseBoardTypeOutput(stdout: string): string | undefined {
	const m = REPLY_RE.exec(stdout);
	return m ? m[1].toLowerCase() : undefined;
}

export type BoardTypeReading = { type: string; port: string };

/**
 * Ask the bootloader which board is attached. Best-effort: undefined whenever there is no answer
 * to be had - no port configured, board not in bootloader mode, or a bootloader without the
 * command - and it never prompts, so a flash is never held up by this.
 */
export async function readBoardType(): Promise<BoardTypeReading | undefined> {
	const port = getBootloaderSerialPort();
	if (!port) return undefined;

	try {
		const out = await runBaoCmd(
			['boardtype', '-p', port, '-b', String(getDefaultBaud())],
			undefined,
			{ capture: true, quiet: true },
		);
		const type = parseBoardTypeOutput(out);
		return type ? { type, port } : undefined;
	} catch {
		return undefined;
	}
}
