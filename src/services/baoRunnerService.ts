import * as path from 'node:path';
import { errorToast, log, warn } from '@services/logService';
import { describeRunFailure, runProcess } from '@services/procService';
import {
	ensureBaoPythonDeps,
	getBaoRunner,
	getBundledToolsRoot,
	getGlobalVenvRoot,
	uvEnv,
} from '@services/uvService';
import { toMessage } from '@util/error';
import * as vscode from 'vscode';

/** Return full path to the bundled bao.py inside the installed extension. */
export function resolveBaoPy(): string {
	const p = path.join(getBundledToolsRoot(), 'bao.py');
	log(`bao.py resolved: ${p}`);
	return p;
}

/**
 * Assemble the argv for a bao.py port/baud subcommand: the runner args (uv run python), bao.py,
 * then `<subcmd> -p <port> -b <baud>` plus any extra flags. Shared by the boot and monitor launches.
 * The caller passes resolveBaoPy() so that call stays cross-module (test stubbing point).
 */
export function buildBaoArgs(
	runnerArgs: string[],
	baoPy: string,
	subcmd: string,
	port: string,
	baud: number,
	extra: string[] = [],
): string[] {
	return [...runnerArgs, baoPy, subcmd, '-p', port, '-b', String(baud), ...extra];
}

/**
 * Best-effort Python dependency check before launching bao.py: installs deps into the global
 * venv when missing (which also creates the storage dir uv runs in). A failure is logged and
 * swallowed so the launch itself surfaces the real error.
 */
export async function ensureBaoDepsQuietly(): Promise<void> {
	try {
		await ensureBaoPythonDeps({ quiet: true });
	} catch (e: unknown) {
		const message = toMessage(e);
		warn(vscode.l10n.t('Baochip: dependency check failed, proceeding anyway.\n{0}', message));
	}
}

/**
 * Run tools-bao via uv, never direct Python.
 * Ensures Python deps are installed first and uses global storage as default CWD so uv finds .venv.
 */
export async function runBaoCmd(
	baoArgs: string[],
	cwd?: string,
	opts: { capture?: boolean; quiet?: boolean; token?: vscode.CancellationToken } = {},
): Promise<string> {
	const { cmd, args } = await getBaoRunner(); // uv + ['run','python']
	const baoPath = resolveBaoPy();

	// Ensure deps before we run anything
	await ensureBaoDepsQuietly();

	const fullArgs = [...args, baoPath, ...baoArgs];

	// Default CWD to global storage so uv discovers .venv there
	const effectiveCwd = cwd ?? getGlobalVenvRoot();

	log(`bao.py INVOKE: ${cmd} ${fullArgs.join(' ')} ${effectiveCwd ? `(cwd=${effectiveCwd})` : ''}`);

	// runProcess captures both streams; we only surface stdout to the caller when capture is requested
	const r = await runProcess(cmd, fullArgs, { cwd: effectiveCwd, env: uvEnv(), token: opts.token });
	log(`bao.py EXIT ${r.code}`);
	if (r.cancelled) {
		// Cancelled via the caller's token - not a failure: no toast and no bogus "exited null".
		log('bao.py run cancelled');
		throw new Error('bao.py run cancelled');
	}
	if (!r.error && r.code === 0) return opts.capture ? r.stdout.trim() : '';
	const msg = describeRunFailure(r);
	if (!opts.quiet) errorToast(vscode.l10n.t('Baochip: bao.py failed.\n{0}', msg));
	throw new Error(msg);
}
