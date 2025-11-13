import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { ensureXousCorePath, resolveBaoPy, getBaoRunner, ensureBaoPythonDeps } from '@services/pathService';
import { REQUIRED_TOOLS_BAO } from '@constants';

function parseSemver(s: string): [number, number, number] | null {
  const m = s.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function cmpSemver(a: string, b: string): number {
  const A = parseSemver(a);
  const B = parseSemver(b);
  if (!A || !B) return NaN as unknown as number;
  for (let i = 0; i < 3; i++) {
    if (A[i] !== B[i]) return A[i] - B[i];
  }
  return 0;
}

async function runBaoVersion(
  runner: { cmd: string; args: string[] },
  baoPy: string,
  cwd: string
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(runner.cmd, [...runner.args, baoPy, '--version'], {
      cwd,
      shell: process.platform === 'win32',
    });
    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || vscode.l10n.t('Exited {0}', String(code))));
      const m = out.trim().match(/(\d+\.\d+\.\d+)/);
      if (!m) return reject(new Error(vscode.l10n.t('Could not parse version from: {0}', out.trim())));
      resolve(m[1]);
    });
  });
}

/**
 * Ensure uv (auto-bootstraps if missing), ensure requirements via uv,
 * then run bao --version and compare against REQUIRED_TOOLS_BAO.
 */
export async function checkToolsBaoVersion(): Promise<boolean> {
  const xousRoot = await ensureXousCorePath().catch(() => undefined);
  if (!xousRoot) return false;

  const baoPy = await resolveBaoPy().catch(() => undefined);
  if (!baoPy) return false;

  try {
    await ensureBaoPythonDeps(xousRoot, { quiet: true });

    const runner = await getBaoRunner(); // uv run python
    const found = await runBaoVersion(runner, baoPy, xousRoot);

    if (cmpSemver(found, REQUIRED_TOOLS_BAO) < 0) {
      vscode.window.showErrorMessage(
        vscode.l10n.t('Your tools-bao is too old (found v{0}, need ≥ v{1}).\nPlease update your xous-core repository to continue.', found, REQUIRED_TOOLS_BAO)
      );
      return false;
    }

    return true;
  } catch (e: any) {
    vscode.window.showErrorMessage(
      vscode.l10n.t('Could not check tools-bao version. Please ensure your xous-core repository is up to date.\nError: {0}', e?.message ?? String(e))
    );
    return false;
  }
}
