import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { getPythonCmd } from '@services/pathService';

const APPS_DIRNAME = 'apps-dabao';

export async function listBaoApps(xousRoot: string): Promise<string[]> {
  const appsDir = path.join(xousRoot, APPS_DIRNAME);
  if (!fs.existsSync(appsDir) || !fs.statSync(appsDir).isDirectory()) return [];
  const entries = fs.readdirSync(appsDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => fs.existsSync(path.join(appsDir, name, 'Cargo.toml')))
    .sort((a, b) => a.localeCompare(b));
}

export function appExists(xousRoot: string, appNames: string): boolean {
  const appsDir = path.join(xousRoot, APPS_DIRNAME);
  const names = appNames.trim().split(/\s+/).filter(Boolean);
  if (names.length === 0) return false;

  return names.every(n => {
    const dir = path.join(appsDir, n);
    return (
      fs.existsSync(dir) &&
      fs.statSync(dir).isDirectory() &&
      fs.existsSync(path.join(dir, 'Cargo.toml'))
    );
  });
}

export function missingApps(xousRoot: string, appNames: string): string[] {
  const appsDir = path.join(xousRoot, APPS_DIRNAME);
  const names = appNames.trim().split(/\s+/).filter(Boolean);
  const missing: string[] = [];
  for (const n of names) {
    const dir = path.join(appsDir, n);
    const ok =
      fs.existsSync(dir) &&
      fs.statSync(dir).isDirectory() &&
      fs.existsSync(path.join(dir, 'Cargo.toml'));
    if (!ok) missing.push(n);
  }
  return missing;
}

// lightweight validator for UX; final validation happens in tools-bao
export function isLikelyValidAppName(name: string): boolean {
  return /^[a-z][a-z0-9_-]*$/.test(name); // lowercase, start with letter
}

// Use tools-bao to create the app
export async function createBaoAppViaCli(xousRoot: string, appName: string): Promise<void> {
  const py = getPythonCmd();
  const bao = path.join(xousRoot, 'tools-bao', 'bao.py');

  await new Promise<void>((resolve, reject) => {
    const child = spawn(py, [bao, 'app', 'create', '--xous-root', xousRoot, '--name', appName], {
      cwd: xousRoot,
      shell: process.platform === 'win32', // helps Windows find python in PATH
    });

    let out = '', err = '';
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });

    child.on('close', code => {
      if (code === 0) return resolve();
      // Surface whatever tools-bao printed
      const msg = (err || out || `Exited with code ${code}`).trim();
      reject(new Error(msg));
    });
  });

  try { await vscode.workspace.saveAll(); } catch {}
}