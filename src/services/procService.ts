import { type ChildProcess, spawn } from 'node:child_process';
import type * as vscode from 'vscode';

export interface RunOptions {
	cwd?: string;
	/** Child environment. When omitted, the child inherits the extension host's process.env. */
	env?: NodeJS.ProcessEnv;
	onStdout?: (chunk: string) => void;
	onStderr?: (chunk: string) => void;
	token?: vscode.CancellationToken;
}

export interface RunResult {
	code: number | null;
	/** The signal that terminated the child, if it was killed by one (code is then null). */
	signal?: NodeJS.Signals | null;
	stdout: string;
	stderr: string;
	error?: Error;
	cancelled: boolean;
}

/** One-line human summary of a failed run: the spawn error, else stderr/stdout, else the signal or exit code. */
export function describeRunFailure(r: RunResult): string {
	if (r.error) return r.error.message;
	const out = (r.stderr || r.stdout).trim();
	if (out) return out;
	// A signal-killed child has a null exit code; report the signal rather than a bare "exited null".
	if (r.signal) return `terminated by signal ${r.signal}`;
	return `exited ${r.code}`;
}

// How long to wait after SIGTERM before escalating to SIGKILL when cancelling a POSIX child.
const SIGKILL_GRACE_MS = 3000;

/**
 * Kill a child and its descendants. child.kill() only signals the direct child, so a build's
 * rustc workers or a uv-run-python grandchild (holding the serial port) would survive a cancel.
 * Windows: taskkill /T /F walks and force-kills the process tree. POSIX: the child is spawned
 * detached as its own process-group leader, so a negative-PID signal reaches the whole group -
 * SIGTERM first, then SIGKILL after a grace period so a SIGTERM-ignoring child cannot hang the run
 * forever (close would never fire). Returns a cleanup that cancels the pending POSIX escalation
 * (runProcess calls it once the child closes); a no-op on Windows / when there is nothing to escalate.
 */
function killTree(child: ChildProcess): () => void {
	if (child.pid === undefined) return () => {};
	const pid = child.pid;
	const fallbackKill = () => {
		try {
			child.kill();
		} catch {}
	};
	if (process.platform === 'win32') {
		try {
			const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
			// A missing taskkill surfaces as an async 'error' event, not a synchronous throw, so the
			// fallback must be a listener - and leaving 'error' unhandled would crash the ext host.
			killer.on('error', fallbackKill);
		} catch {
			fallbackKill();
		}
		return () => {}; // taskkill /f already force-kills the tree; no escalation needed
	}
	try {
		process.kill(-pid, 'SIGTERM'); // negative pid = the whole process group
	} catch {
		fallbackKill();
		return () => {};
	}
	// SIGKILL is uncatchable, so it stops even a SIGTERM-ignoring child; unref so the pending timer
	// never keeps the extension host's event loop alive on its own.
	const escalation = setTimeout(() => {
		try {
			process.kill(-pid, 'SIGKILL');
		} catch {}
	}, SIGKILL_GRACE_MS);
	escalation.unref?.();
	return () => clearTimeout(escalation);
}

/**
 * Spawn a process without a shell, so args are passed directly to the OS (no quoting, no metacharacter
 * interpretation, spaces in paths just work). Never rejects; always resolves a normalized result.
 */
export function runProcess(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
	return new Promise((resolve) => {
		// detached (POSIX only) puts the child in its own process group so killTree can signal the
		// whole tree; we always await 'close' and never unref, so the child cannot outlive us.
		const child = spawn(cmd, args, {
			cwd: opts.cwd,
			env: opts.env,
			shell: false,
			detached: process.platform !== 'win32',
		});
		let stdout = '';
		let stderr = '';
		let cancelled = false;
		let settled = false;

		let cancelEscalation: (() => void) | undefined;
		const sub = opts.token?.onCancellationRequested(() => {
			cancelled = true;
			cancelEscalation = killTree(child);
		});

		const finish = (r: RunResult) => {
			if (settled) return;
			settled = true;
			cancelEscalation?.(); // clear the pending SIGKILL once the child has actually closed
			sub?.dispose();
			resolve(r);
		};

		// Decode as UTF-8 with a StringDecoder so a multibyte character split across two chunks is
		// not mangled (a naive per-chunk toString() would corrupt it - matters for e.g. Japanese).
		child.stdout?.setEncoding('utf8');
		child.stderr?.setEncoding('utf8');

		child.stdout?.on('data', (d) => {
			const s = d.toString();
			stdout += s;
			opts.onStdout?.(s);
		});
		child.stderr?.on('data', (d) => {
			const s = d.toString();
			stderr += s;
			opts.onStderr?.(s);
		});
		child.on('error', (error) => finish({ code: null, stdout, stderr, error, cancelled }));
		child.on('close', (code, signal) => finish({ code, signal, stdout, stderr, cancelled }));
	});
}
