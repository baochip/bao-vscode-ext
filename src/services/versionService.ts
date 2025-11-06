import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { ensureXousCorePath, resolveBaoPy, getBaoPythonCmd } from '@services/pathService';
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

async function runBaoVersion(py: string, baoPy: string, cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(py, [baoPy, '--version'], { cwd, shell: process.platform === 'win32' });
    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err || `Exited ${code}`));
      const m = out.trim().match(/(\d+\.\d+\.\d+)/);
      if (!m) return reject(new Error(`Could not parse version from: ${out.trim()}`));
      resolve(m[1]);
    });
  });
}

export async function checkToolsBaoVersion(): Promise<boolean> {
  const xousRoot = await ensureXousCorePath().catch(() => undefined);
  if (!xousRoot) return false;

  const baoPy = await resolveBaoPy().catch(() => undefined);
  if (!baoPy) return false;

  try {
    const py = getBaoPythonCmd(xousRoot);
    const found = await runBaoVersion(py, baoPy, xousRoot);

    if (cmpSemver(found, REQUIRED_TOOLS_BAO) < 0) {
      vscode.window.showErrorMessage(
        `Your tools-bao is too old (found v${found}, need ≥ v${REQUIRED_TOOLS_BAO}).\n` +
        `Please update your xous-core repository to continue.`
      );
      return false;
    }

    return true;
  } catch (e: any) {
    vscode.window.showErrorMessage(
      `Could not check tools-bao version. Please ensure your xous-core repository is up to date.\n` +
      `Error: ${e?.message ?? e}`
    );
    return false;
  }
}