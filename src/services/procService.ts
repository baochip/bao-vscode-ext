import { spawn } from 'node:child_process';
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

/**
 * Spawn a process without a shell, so args are passed directly to the OS (no quoting, no metacharacter
 * interpretation, spaces in paths just work). Never rejects; always resolves a normalized result.
 */
export function runProcess(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env, shell: false });
		let stdout = '';
		let stderr = '';
		let cancelled = false;
		let settled = false;

		const sub = opts.token?.onCancellationRequested(() => {
			cancelled = true;
			try {
				child.kill();
			} catch {}
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
