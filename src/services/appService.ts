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

export function appExists(xousRoot: string, appName: string): boolean {
  const appDir = path.join(xousRoot, APPS_DIRNAME, appName);
  return fs.existsSync(appDir) && fs.statSync(appDir).isDirectory();
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