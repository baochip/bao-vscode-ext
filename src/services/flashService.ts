import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { fetchArtifacts, BaoArtifact } from '@services/artifactsService';
import { getUpdateAllInfo } from '@services/updateService';
import { getFlashLocation, setFlashLocation, getMonitorPort, getDefaultBaud } from '@services/configService';

export async function ensureFlashLocation(): Promise<string | undefined> {
  let dest = getFlashLocation();
  if (!dest) {
    const pick = await vscode.window.showOpenDialog({
      title: 'Select mounted Baochip UF2 drive',
      canSelectFiles: false, canSelectFolders: true, canSelectMany: false, openLabel: 'Use this location',
    });
    if (!pick || pick.length === 0) return undefined;
    dest = pick[0].fsPath;
    await setFlashLocation(dest);
  }
  return dest;
}

export async function gatherArtifacts(py: string, bao: string, root: string) {
  const images = await fetchArtifacts(py, bao, root).catch(() => []);
  const byRole: Record<'loader'|'xous'|'app', string | undefined> = {
    loader: images.find(i => i.role === 'loader')?.path,
    xous:  images.find(i => i.role === 'xous')?.path,
    app:   images.find(i => i.role === 'app')?.path,
  };
  const all: string[] = (['loader','xous','app'] as const).map(r => byRole[r]).filter((p): p is string => !!p);
  const appOnly: string[] = byRole.app ? [byRole.app] : [];
  return { byRole, all, appOnly };
}

export async function flashFiles(py: string, bao: string, root: string, dest: string, files: string[], forceLabel?: string) {
  const chan = vscode.window.createOutputChannel('Bao Flash');
  chan.show(true);

  if (forceLabel) chan.appendLine(`[bao] ${forceLabel}`);
  chan.appendLine(`[bao] Flash destination: ${dest}`);
  chan.appendLine('[bao] Files:'); files.forEach(f => chan.appendLine(`  - ${f}`));

  const args = [bao, 'flash', '--dest', dest, ...files];

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Baochip: Flashing…', cancellable: true },
    async (_progress, token) =>
      new Promise<void>((resolve) => {
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
          } else {
            const msg = (stderrBuf || stdoutBuf || `exit ${code}`).trim().slice(0, 300);
            vscode.window.showErrorMessage(`Baochip flash failed: ${msg}`);
          }
          resolve();
        });
      })
  );
}

export async function decideAndFlash(py: string, bao: string, root: string) {
  const dest = await ensureFlashLocation();
  if (!dest) return;

  const { all, appOnly } = await gatherArtifacts(py, bao, root);
  if (all.length === 0 && appOnly.length === 0) {
    vscode.window.showWarningMessage('No UF2s found (loader/xous/app). Build first, then flash.');
    return;
  }

  const monPort = getMonitorPort();
  const baud = getDefaultBaud();
  if (!monPort) {
    const a = await vscode.window.showWarningMessage('No monitor port set. Set it to check versions.', 'Set Port');
    if (a === 'Set Port') await vscode.commands.executeCommand('baochip.setMonitorPort');
    return;
  }

  // Query versions and log them
  const info = await getUpdateAllInfo(py, bao, root, monPort, baud);
  const chan = vscode.window.createOutputChannel('Bao Flash'); chan.show(true);
  chan.appendLine(`[bao] Versions:`);
  chan.appendLine(`  local: ${info.localSemver ?? '(unknown)'}  ${info.localTimestamp ?? ''}`.trim());
  chan.appendLine(`  board: ${info.boardSemver ?? '(unknown)'}  ${info.boardTimestamp ?? ''}`.trim());
  chan.appendLine(`  update-all: ${info.updateAll ? 'YES' : 'no'}`);

  const files = info.updateAll ? all : appOnly;
  if (files.length === 0) {
    vscode.window.showWarningMessage(info.updateAll
      ? 'No UF2s found to flash (loader/xous/app).'
      : 'No app.uf2 found to flash.');
    return;
  }

  await flashFiles(py, bao, root, dest, files);
}

export async function flashForceAll(py: string, bao: string, root: string) {
  const dest = await ensureFlashLocation();
  if (!dest) return;

  const { all } = await gatherArtifacts(py, bao, root);
  if (all.length === 0) {
    vscode.window.showWarningMessage('No UF2s found (loader/xous/app). Build first, then flash.');
    return;
  }
  await flashFiles(py, bao, root, dest, all, 'FORCE mode: flashing all available UF2s (no version checks).');
}
