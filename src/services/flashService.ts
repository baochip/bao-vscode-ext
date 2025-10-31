import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { fetchArtifacts } from '@services/artifactsService';
import { getFlashLocation, setFlashLocation } from '@services/configService';

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(absPath));
    return true;
  } catch {
    return false;
  }
}

export async function ensureFlashLocation(): Promise<string | undefined> {
  let dest = getFlashLocation();
  if (!dest) {
    const pick = await vscode.window.showOpenDialog({
      title: 'Select mounted Baochip UF2 drive',
      canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
      openLabel: 'Use this location',
    });
    if (!pick || pick.length === 0) return undefined;
    dest = pick[0].fsPath;
    await setFlashLocation(dest);
  }

  // Always ensure it exists at time of flashing
  if (!(await pathExists(dest))) {
    vscode.window.showErrorMessage(
      `Flash location not found: ${dest}  Is the board mounted? ` +
      `Make sure the board appears as a drive, press RESET if needed.`
    );
    return undefined; // cancel flash
  }

  return dest;
}

export async function gatherArtifacts(py: string, bao: string, root: string) {
  const images = await fetchArtifacts(py, bao, root).catch(() => []);
  const byRole: Record<'loader'|'xous'|'apps', string | undefined> = {
    loader: images.find(i => i.role === 'loader')?.path,
    xous:  images.find(i => i.role === 'xous')?.path,
    apps:   images.find(i => i.role === 'apps')?.path,
  };
  const all: string[] = (['loader','xous','apps'] as const).map(r => byRole[r]).filter((p): p is string => !!p);
  return { byRole, all };
}

export async function flashFiles(
  py: string, bao: string, root: string, dest: string, files: string[], forceLabel?: string
): Promise<boolean> {
  const chan = vscode.window.createOutputChannel('Bao Flash');
  chan.show(true);
  if (forceLabel) chan.appendLine(`[bao] ${forceLabel}`);
  chan.appendLine(`[bao] Flash destination: ${dest}`);
  chan.appendLine('[bao] Files:'); files.forEach(f => chan.appendLine(`  - ${f}`));

  const args = [bao, 'flash', '--dest', dest, ...files];

  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Baochip: Flashing…', cancellable: true },
    async (_progress, token) =>
      new Promise<boolean>((resolve) => {
        const total = files.length;
        let copied = 0, stdoutBuf = '', stderrBuf = '';
        const child = spawn(py, args, { cwd: root, shell: process.platform === 'win32' });

        token.onCancellationRequested(() => { try { child.kill(); } catch {} chan.appendLine('[bao] Cancelled by user.'); });

        const bump = () => { copied = Math.min(total, copied + 1); };

        child.stdout.on('data', (d) => {
          const s = d.toString(); stdoutBuf += s; chan.append(s);
          if (/\bcopy\b.+->/i.test(s)) bump();
          const m = s.match(/copied\s+(\d+)\s+file\(s\)/i);
          if (m) copied = Math.max(copied, parseInt(m[1], 10) || copied);
        });
        child.stderr.on('data', (d) => { const s = d.toString(); stderrBuf += s; chan.append(s); });
        child.on('close', (code) => {
          if (code === 0) {
            vscode.window.showInformationMessage(`Baochip: flashed ${copied || total} file(s) to ${dest}.`);
            resolve(true);
          } else {
            const msg = (stderrBuf || stdoutBuf || `exit ${code}`).trim().slice(0, 300);
            vscode.window.showErrorMessage(`Baochip flash failed: ${msg}`);
            resolve(false);
          }
        });
      })
  );
}

export async function decideAndFlash(py: string, bao: string, root: string): Promise<boolean> {
  const dest = await ensureFlashLocation();
  if (!dest) return false; // path missing/cancelled → stop

  const { all } = await gatherArtifacts(py, bao, root);
  if (all.length === 0) {
    vscode.window.showWarningMessage('No UF2s found (loader/xous/apps). Build first, then flash.');
    return false;
  }

  return flashFiles(py, bao, root, dest, all);
}