import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { ensureXousCorePath, resolveBaoPy, getPythonCmd } from '@services/pathService';
import { getBuildTarget, getXousAppName, getFlashLocation, setFlashLocation, getMonitorPort, getDefaultBaud } from '@services/configService';
import { fetchArtifacts, BaoArtifact } from '@services/artifactsService';
import { getUpdateAllInfo } from '@services/updateService';

function terminal(name: string): vscode.Terminal {
  return vscode.window.terminals.find(t => t.name === name) ?? vscode.window.createTerminal({ name });
}

export function registerFlashCommand(_context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand('baochip.flash', async () => {
    // Preconditions
    let root: string, bao: string, py: string;
    try { root = await ensureXousCorePath(); bao = await resolveBaoPy(); py = getPythonCmd(); }
    catch (e: any) { vscode.window.showErrorMessage(e?.message || 'xous-core / bao.py not set'); return; }

    const target = getBuildTarget();
    if (!target) {
      const a = await vscode.window.showWarningMessage('No build target set.', 'Select Target');
      if (a === 'Select Target') await vscode.commands.executeCommand('baochip.selectBuildTarget');
      return;
    }

    const app = getXousAppName();
    if (!app) {
      await vscode.window.showWarningMessage('No app selected.');
      await vscode.commands.executeCommand('baochip.selectApp');
      return;
    }

    // Flash Location (folder)
    let dest = getFlashLocation();
    if (!dest) {
      const pick = await vscode.window.showOpenDialog({
        title: 'Select mounted Baochip UF2 drive',
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Use this location',
      });
      if (!pick || pick.length === 0) return;
      dest = pick[0].fsPath;
      await setFlashLocation(dest);
    }

    // Fetch artifacts (we expect roles: loader, xous, app)
    const images = await fetchArtifacts(py, bao, root).catch(() => []);
    const want: BaoArtifact['role'][] = ['loader', 'xous', 'app'];
    const orderedFiles = want
      .map(r => images.find(i => i.role === r)?.path)
      .filter((p): p is string => !!p);

    if (orderedFiles.length === 0) {
      vscode.window.showWarningMessage('No UF2s found (loader/xous/app). Build first, then flash.');
      return;
    }

    const byRole = Object.fromEntries(images.map(i => [i.role || '', i.path]));

    // Decide update scope by querying board version
    const monPort = getMonitorPort();
    const baud = getDefaultBaud();
    if (!monPort) {
        vscode.window.showWarningMessage('No monitor port set. Set it before flashing so we can check versions.');
        await vscode.commands.executeCommand('baochip.setMonitorPort');
        return;
    }

    // Output channel setup
    const chan = vscode.window.createOutputChannel('Bao Flash');
    chan.show(true);

    // Ask update-all & log versions
    let info;
    try {
        info = await getUpdateAllInfo(py, bao, root, monPort, baud);
    } catch (e: any) {
        vscode.window.showErrorMessage(e?.message || 'Failed to check board version. Is the board connected and running?');
        return;
    }
    chan.appendLine(`[bao] Versions:`);
    chan.appendLine(`  local: ${info.localSemver ?? '(unknown)'}  ${info.localTimestamp ?? ''}`.trim());
    chan.appendLine(`  board: ${info.boardSemver ?? '(unknown)'}  ${info.boardTimestamp ?? ''}`.trim());
    chan.appendLine(`  update-all: ${info.updateAll ? 'YES' : 'no'}`);

    // Choose files based on updateAll
    const files: string[] = [];
    if (info.updateAll) {
        ['loader','xous','app'].forEach(r => { const p = byRole[r]; if (p) files.push(p); });
    } else {
        if (byRole['app']) files.push(byRole['app']);
    }
    
    if (files.length === 0) {
    vscode.window.showWarningMessage(info.updateAll
        ? 'No UF2s found (loader/xous/app). Build first, then flash.'
        : 'No app.uf2 found. Build first, then flash.');
    return;
    }

    // Build argv for: python <bao.py> flash --dest <mount> <file1> <file2> ...
    const args = [bao, 'flash', '--dest', dest, ...orderedFiles];

    // Output channel for detailed logs
    chan.appendLine(`[bao] Flash destination: ${dest}`);
    chan.appendLine(`[bao] Files:`);
    for (const f of orderedFiles) chan.appendLine(`  - ${f}`);

    const total = orderedFiles.length;

    await vscode.window.withProgress(
    {
        location: vscode.ProgressLocation.Notification,
        title: 'Baochip: Flashing…',
        cancellable: true,
    },
        async (progress, token) =>
            new Promise<void>((resolve) => {
            let copied = 0;
            let stdoutBuf = '';
            let stderrBuf = '';

            // initial nudge
            progress.report({ message: `Starting (0/${total})` });

            const child = spawn(py, args, { cwd: root, shell: process.platform === 'win32' });

            token.onCancellationRequested(() => {
                try { child.kill(); } catch {}
                chan.appendLine('[bao] Cancelled by user.');
            });

            const bump = () => {
                copied += 1;
                const pct = Math.min(99, Math.floor((copied / total) * 100));
                progress.report({ message: `Copying (${copied}/${total})`, increment: 0 });
            };

            child.stdout.on('data', (d) => {
                const s = d.toString();
                stdoutBuf += s;
                chan.append(s);

                // Heuristic: count progress when we see a "copy ..." line
                // e.g., "[bao] copy <src> -> <dst>"
                if (/\bcopy\b.+->/i.test(s)) bump();

                // Also pick up the final "copied N file(s)" line if present
                const m = s.match(/copied\s+(\d+)\s+file\(s\)/i);
                if (m) copied = Math.max(copied, parseInt(m[1], 10) || copied);
            });

            child.stderr.on('data', (d) => {
                const s = d.toString();
                stderrBuf += s;
                chan.append(s);
            });

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