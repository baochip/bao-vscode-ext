import * as path from 'node:path';
import { errorToast, log, warn } from '@services/logService';
import { runProcess } from '@services/procService';
import {
	ensureBaoPythonDeps,
	getBaoRunner,
	getBundledToolsRoot,
	getGlobalVenvRoot,
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
 * Run tools-bao via uv, never direct Python.
 * Ensures Python deps are installed first and uses global storage as default CWD so uv finds .venv.
 */
export async function runBaoCmd(
	baoArgs: string[],
	cwd?: string,
	opts: { capture?: boolean; quiet?: boolean } = {},
): Promise<string> {
	const { cmd, args } = await getBaoRunner(); // uv + ['run','python']
	const baoPath = resolveBaoPy();

	// Ensure deps before we run anything
	try {
		await ensureBaoPythonDeps({ quiet: true });
	} catch (e: unknown) {
		const message = toMessage(e);
		warn(vscode.l10n.t('Baochip: dependency check failed, proceeding anyway.\n{0}', message));
	}

	const fullArgs = [...args, baoPath, ...baoArgs];

	// Default CWD to global storage so uv discovers .venv there
	const effectiveCwd = cwd ?? getGlobalVenvRoot();

	log(`bao.py INVOKE: ${cmd} ${fullArgs.join(' ')} ${effectiveCwd ? `(cwd=${effectiveCwd})` : ''}`);

	// runProcess captures both streams; we only surface stdout to the caller when capture is requested
	const r = await runProcess(cmd, fullArgs, { cwd: effectiveCwd });
	log(`bao.py EXIT ${r.code}`);
	if (!r.error && r.code === 0) return opts.capture ? r.stdout.trim() : '';
	const msg = (
		r.error ? r.error.message : r.stderr || r.stdout || `bao.py exited ${r.code}`
	).trim();
	if (!opts.quiet) errorToast(vscode.l10n.t('Baochip: bao.py failed.\n{0}', msg));
	throw new Error(msg);
}
