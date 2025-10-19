import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { ensureXousCorePath, resolveBaoPy, getPythonCmd } from '@services/pathService';
import { getBuildTarget, getXousAppName, getFlashLocation, setFlashLocation } from '@services/configService';
import { fetchArtifacts } from '@services/artifactsService';

export function registerFlashForceAll(_context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand('baochip.flashForceAll', async () => {
    // Preconditions
    let root: string, bao: string, py: string;
    try { root = await ensureXousCorePath(); bao = await resolveBaoPy(); py = getPythonCmd(); }
    catch (e: any) { vscode.window.showErrorMessage(e?.message || 'xous-core / bao.py not set'); return; }

    const target = getBuildTarget();
    if (!target) { const a = await vscode.window.showWarningMessage('No build target set.', 'Select Target'); if (a==='Select Target') await vscode.commands.executeCommand('baochip.selectBuildTarget'); return; }

    const app = getXousAppName();
    if (!app) { await vscode.window.showWarningMessage('No app selected.'); await vscode.commands.executeCommand('baochip.selectApp'); return; }

    // Flash Location
    let dest = getFlashLocation();
    if (!dest) {
      const pick = await vscode.window.showOpenDialog({
        title: 'Select mounted Baochip UF2 drive',
        canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
        openLabel: 'Use this location',
      });
      if (!pick || pick.length === 0) return;
      dest = pick[0].fsPath;
      await setFlashLocation(dest);
    }

    // Collect all three if present
    const images = await fetchArtifacts(py, bao, root).catch(() => []);
    const files = (['loader','xous','app'] as const)
      .map(role => images.find(i => i.role === role)?.path)
      .filter((p): p is string => !!p);

    if (files.length === 0) {
      vscode.window.showWarningMessage('No UF2s found (loader/xous/app). Build first, then flash.');
      return;
    }

    // Output/Spinner + spawn
    const chan = vscode.window.createOutputChannel('Bao Flash');
    chan.show(true);
    chan.appendLine('[bao] FORCE mode: flashing all available UF2s (no version checks).');
    chan.appendLine(`[bao] Flash destination: ${dest}`);
    chan.appendLine('[bao] Files:');
    files.forEach(f => chan.appendLine(`  - ${f}`));

    const args = [bao, 'flash', '--dest', dest, ...files];

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Baochip: Flashing (force all)…', cancellable: true },
      async (progress, token) =>
        new Promise<void>((resolve) => {
          const total = files.length;
          let copied = 0, stdoutBuf = '', stderrBuf = '';
          progress.report({ message: `Starting (0/${total})` });

          const child = spawn(py, args, { cwd: root, shell: process.platform === 'win32' });

          token.onCancellationRequested(() => { try { child.kill(); } catch {} chan.appendLine('[bao] Cancelled by user.'); });

          const bump = () => {
            copied = Math.min(total, copied + 1);
            progress.report({ message: `Copying (${copied}/${total})` });
          };

          child.stdout.on('data', (d) => {
            const s = d.toString(); stdoutBuf += s; chan.append(s);
            if (/\bcopy\b.+->/i.test(s)) bump();
            const m = s.match(/copied\s+(\d+)\s+file\(s\)/i);
            if (m) copied = Math.max(copied, parseInt(m[1], 10) || copied);
          });
          child.stderr.on('data', (d) => { const s = d.toString(); stderrBuf += s; chan.append(s); });
          child.on('close', (code) => {
            if (code === 0) {
              const n = copied || total;
              vscode.window.showInformationMessage(`Baochip: flashed ${n} file(s) to ${dest}.`);
            } else {
              const msg = (stderrBuf || stdoutBuf || `exit ${code}`).trim().slice(0, 300);
              vscode.window.showErrorMessage(`Baochip flash failed: ${msg}`);
            }
            resolve();
          });
        })
    );
  });
}
