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
	stdout: string;
	stderr: string;
	error?: Error;
	cancelled: boolean;
}

/** One-line human summary of a failed run: the spawn error, else stderr/stdout, else the exit code. */
export function describeRunFailure(r: RunResult): string {
	if (r.error) return r.error.message;
	return (r.stderr || r.stdout || `exited ${r.code}`).trim();
}

/**
 * Kill a child and its descendants. child.kill() only signals the direct child, so a build's
 * rustc workers or a uv-run-python grandchild (holding the serial port) would survive a cancel.
 * Windows: taskkill /T walks the process tree. POSIX: the child is spawned detached as its own
 * process-group leader, so a negative-PID signal reaches the whole group.
 */
function killTree(child: ChildProcess): void {
	if (child.pid === undefined) return;
	if (process.platform === 'win32') {
		try {
			spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
		} catch {
			try {
				child.kill();
			} catch {}
		}
		return;
	}
	try {
		process.kill(-child.pid, 'SIGTERM'); // negative pid = the whole process group
	} catch {
		try {
			child.kill();
		} catch {}
	}
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

		const sub = opts.token?.onCancellationRequested(() => {
			cancelled = true;
			killTree(child);
		});

		const finish = (r: RunResult) => {
			if (settled) return;
			settled = true;
			sub?.dispose();
			resolve(r);
		};

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
		child.on('close', (code) => finish({ code, stdout, stderr, cancelled }));
	});
}
