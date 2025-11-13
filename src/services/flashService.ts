import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
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

async function promptForFlashFolder(): Promise<string | undefined> {
  const pick = await vscode.window.showOpenDialog({
    title: 'Select mounted BAOCHIP drive',
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Use this location',
  });
  return pick && pick.length > 0 ? pick[0].fsPath : undefined;
}

// Poll the same path briefly to allow a freshly mounted drive to appear.
async function waitForDrive(absPath: string, timeoutMs = 8000, intervalMs = 500): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pathExists(absPath)) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

export async function ensureFlashLocation(): Promise<string | undefined> {
  let dest = getFlashLocation();

  // Case 1: not set yet → prompt to pick & save
  if (!dest) {
    const ok = await vscode.window.showInformationMessage(
      'Select the drive where BAOCHIP is mounted.\n\n' +
      '• The board should appear as a removable drive named "BAOCHIP".\n' +
      '• If you can’t see it, press RESET on the board.',
      { modal: true },
      'Select Folder'
    );
    if (ok !== 'Select Folder') return undefined;

    const picked = await promptForFlashFolder();
    if (!picked) return undefined;

    await setFlashLocation(picked);
    dest = picked;
  }

  // Case 2: set but missing → offer "Select New Location" or "Continue"
  if (!(await pathExists(dest))) {
    const choice = await vscode.window.showWarningMessage(
      `Device not found at ${dest}\n\n` +
      '• Is the board plugged in?\n' +
      '• Is the board in bootloader mode? (press RESET on the board)\n\n' +
      'Select "Continue" if the device appears after checking cable and pressing RESET.\n\n' +
      'Otherwise, select a new location for the BAOCHIP device.',
      { modal: true },
      'Select New Location',
      'Continue'
    );

    if (choice === 'Select New Location') {
      const picked = await promptForFlashFolder();
      if (!picked) return undefined;
      await setFlashLocation(picked);
      dest = picked;

      if (!(await pathExists(dest))) {
        vscode.window.showErrorMessage(`Selected location is not accessible: ${dest}`);
        return undefined;
      }
    } else if (choice === 'Continue') {
      const appeared = await waitForDrive(dest, 8000, 500);
      if (!appeared) {
        vscode.window.showErrorMessage(`Drive did not appear at: ${dest}`);
        return undefined;
      }
    } else {
      return undefined; // user cancelled
    }
  }

  return dest;
}

export async function gatherArtifacts(root: string) {
  const images = await fetchArtifacts(root).catch(() => []);
  const byRole: Record<'loader'|'xous'|'apps', string | undefined> = {
    loader: images.find((i: any) => i.role === 'loader')?.path,
    xous:   images.find((i: any) => i.role === 'xous')?.path,
    apps:   images.find((i: any) => i.role === 'apps')?.path,
  };
  const all: string[] = (['loader','xous','apps'] as const)
    .map(r => byRole[r])
    .filter((p): p is string => !!p);

  return { byRole, all };
}

export async function flashFiles(dest: string, files: string[]): Promise<boolean> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Baochip: Flashing…', cancellable: true },
    async (_progress, token) => {
      try {
        let copied = 0;
        const chan = vscode.window.createOutputChannel('Bao Flash');
        chan.show(true);

        for (const srcPath of files) {
          if (token.isCancellationRequested) break;

          const fileName = path.basename(srcPath);
          const srcUri = vscode.Uri.file(srcPath);
          const dstUri = vscode.Uri.file(path.join(dest, fileName));

          // Compute MD5 hash
          const buf = fs.readFileSync(srcUri.fsPath);
          const md5 = crypto.createHash('md5').update(buf).digest('hex');

          chan.appendLine(`[bao] Flashing ${fileName}`);
          chan.appendLine(`      MD5: ${md5}`);

          await vscode.workspace.fs.copy(srcUri, dstUri, { overwrite: true });
          copied++;
        }

        if (token.isCancellationRequested) {
          vscode.window.showWarningMessage('Baochip: Flash cancelled.');
          return false;
        }

        vscode.window.showInformationMessage(`Baochip: flashed ${copied} file(s) to ${dest}.`);
        chan.appendLine(`[bao] Flash complete (${copied} file${copied === 1 ? '' : 's'})`);
        return true;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        vscode.window.showErrorMessage(`Baochip flash failed: ${msg}`);
        return false;
      }
    }
  );
}

export async function decideAndFlash(root: string): Promise<boolean> {
  const dest = await ensureFlashLocation();
  if (!dest) return false;

  const { all } = await gatherArtifacts(root);
  if (all.length === 0) {
    vscode.window.showWarningMessage('No UF2s found (loader/xous/apps). Build first, then flash.');
    return false;
  }

  return flashFiles(dest, all);
}
