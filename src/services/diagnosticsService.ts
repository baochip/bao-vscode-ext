import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runBaoCmd } from '@services/baoRunnerService';
import {
	getBootloaderSerialPort,
	getBuildTargetOrDefault,
	getDefaultBaud,
	getFlashLocation,
	getKernelMode,
	getMonitorDefaultPort,
	getMonitorFlags,
	getRunSerialPort,
	getXousAppName,
} from '@services/configService';
import { runProcess } from '@services/procService';
import { getProjectMode } from '@services/projectModeService';
import { isXousToolkitInstalled } from '@services/toolkitService';
import { getBaoRunner, getGlobalVenvRoot, uvEnv } from '@services/uvService';
import * as vscode from 'vscode';

const EXT_ID = 'baochip.bao-vscode-ext';
const PROBE_TIMEOUT_MS = 8000;

/** Clipboard seam: vscode.env.clipboard is frozen, so tests stub this wrapper instead. */
export async function copyToClipboard(text: string): Promise<void> {
	await vscode.env.clipboard.writeText(text);
}

/** Replace the user's home directory in a path with ~ so reports do not carry the username. */
function redactHome(p: string): string {
	const home = os.homedir();
	return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

/** One probe line; failures are captured, never thrown, so one broken tool cannot kill the report. */
async function probe(name: string, fn: () => Promise<string>): Promise<string> {
	try {
		const value = await Promise.race([
			fn(),
			new Promise<string>((_, reject) =>
				setTimeout(
					() => reject(new Error(`timed out after ${PROBE_TIMEOUT_MS}ms`)),
					PROBE_TIMEOUT_MS,
				),
			),
		]);
		return `[ok]   ${name}: ${value}`;
	} catch (e) {
		return `[FAIL] ${name}: ${e instanceof Error ? e.message : String(e)}`;
	}
}

/** First output line of `cmd <args>`, or a throw carrying the failure. */
async function toolVersion(cmd: string, args: string[] = ['--version']): Promise<string> {
	const r = await runProcess(cmd, args, {});
	if (r.error) throw r.error;
	if (r.code !== 0) throw new Error(`exited ${r.code}: ${r.stderr.trim() || r.stdout.trim()}`);
	return (r.stdout || r.stderr).trim().split(/\r?\n/)[0];
}

/**
 * Gather the setup facts a bug report needs: versions, mode/settings, and a pass/fail probe of
 * every tool in the chain. Never throws - a failure becomes a [FAIL] line instead.
 *
 * The report is deliberately NOT localized: it is written for the extension maintainers and
 * travels into GitHub issues, where a single language keeps every report comparable.
 */
export async function buildDiagnosticsReport(): Promise<string> {
	const lines: string[] = [];
	try {
		const ext = vscode.extensions.getExtension(EXT_ID);
		const extVersion = (ext?.packageJSON as { version?: string } | undefined)?.version ?? 'unknown';
		lines.push(
			`Baochip ${extVersion} | VS Code ${vscode.version} | ${process.platform} ${process.arch} (${os.release()}) | lang ${vscode.env.language}`,
		);
		// Folder COUNT only, never names: names are customer-identifying, while the diagnostic
		// signal is the shape (no folder / single / multi-root).
		const folderCount = (vscode.workspace.workspaceFolders ?? []).length;
		const folders =
			folderCount === 0 ? '(none)' : `${folderCount} folder${folderCount === 1 ? '' : 's'}`;
		lines.push(
			`Mode: ${getProjectMode()} | target: ${getBuildTargetOrDefault()} | app: ${getXousAppName() || '(none)'} | workspace: ${folders}`,
		);
		const flags = getMonitorFlags();
		lines.push(
			`Settings: run=${getRunSerialPort() || '(unset)'} boot=${getBootloaderSerialPort() || '(unset)'} ` +
				`baud=${getDefaultBaud()} crlf=${flags.crlf ? 'on' : 'off'} raw=${flags.raw ? 'on' : 'off'} ` +
				`echo=${flags.echo ? 'on' : 'off'} monitorDefault=${getMonitorDefaultPort()} ` +
				`kernelMode=${getKernelMode()} flashLocation=${getFlashLocation() || '(unset)'}`,
		);

		const venvRoot = getGlobalVenvRoot();
		const kernelDir = path.join(venvRoot, 'kernel');
		const cached = (name: string) => (fs.existsSync(path.join(kernelDir, name)) ? 'yes' : 'no');
		lines.push(
			`Kernel cache: loader.uf2=${cached('loader.uf2')} xous.uf2=${cached('xous.uf2')} etags=${cached('etags.json')}`,
		);

		lines.push(
			...(await Promise.all([
				probe('uv', async () => {
					const { cmd } = await getBaoRunner({ quiet: true });
					return `${await toolVersion(cmd)} at ${redactHome(cmd)}`;
				}),
				probe('venv + python', async () => {
					if (!fs.existsSync(path.join(venvRoot, '.venv'))) {
						throw new Error('.venv missing (run any Baochip command to create it)');
					}
					const { cmd, args } = await getBaoRunner({ quiet: true });
					const r = await runProcess(cmd, [...args, '--version'], {
						cwd: venvRoot,
						env: uvEnv(),
					});
					if (r.error) throw r.error;
					if (r.code !== 0) throw new Error(`exited ${r.code}: ${r.stderr.trim()}`);
					return (r.stdout || r.stderr).trim().split(/\r?\n/)[0];
				}),
				probe('serial ports (bao.py)', async () => {
					const out = await runBaoCmd(['ports'], undefined, { capture: true, quiet: true });
					const ports = out
						.split(/\r?\n/)
						.map((l) => l.trim())
						.filter(Boolean)
						.map((l) => {
							const [port, desc] = l.split('\t');
							return desc ? `${port} (${desc})` : port;
						});
					return ports.length ? `${ports.length} found: ${ports.join(', ')}` : 'none found';
				}),
				probe('rustc', () => toolVersion('rustc')),
				probe('cargo', () => toolVersion('cargo')),
				probe('riscv target (rustup)', async () => {
					// The rustup-managed bare-metal target, matching rustCheckService's setup check.
					// The custom Xous triple never appears in rustup's list - it lives in the rust
					// sysroot and is covered by the toolkit probe below.
					const r = await runProcess('rustup', ['target', 'list', '--installed'], {});
					if (r.error) throw r.error;
					if (!r.stdout.includes('riscv32imac-unknown-none-elf')) {
						throw new Error('riscv32imac-unknown-none-elf not installed');
					}
					return 'installed';
				}),
				probe('xous target (sysroot)', async () => {
					// riscv32imac-unknown-xous-elf is the triple builds compile FOR; the Xous toolkit
					// installs it into the rust sysroot, and rustup never lists it.
					if (!(await isXousToolkitInstalled())) {
						throw new Error(
							'riscv32imac-unknown-xous-elf missing from the rust sysroot - install the Xous toolkit',
						);
					}
					return 'riscv32imac-unknown-xous-elf installed (Xous toolkit)';
				}),
			])),
		);
	} catch (e) {
		lines.push(`[FAIL] diagnostics collection: ${e instanceof Error ? e.message : String(e)}`);
	}
	return lines.join('\n');
}
