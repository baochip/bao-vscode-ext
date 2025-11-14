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
    title: vscode.l10n.t('Select mounted baochip drive'),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: vscode.l10n.t('Use this location'),
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
    const selectFolderLabel = vscode.l10n.t('Select Folder');

    const ok = await vscode.window.showInformationMessage(
      vscode.l10n.t('You need to select the drive where your baochip is mounted.\n\n1) Make sure your baochip is plugged in.\n2) If you cannot see the BAOCHIP drive on your computer, press the RESET button and wait for the drive to appear.'),
      { modal: true },
      selectFolderLabel
    );
    if (ok !== selectFolderLabel) return undefined;

    const picked = await promptForFlashFolder();
    if (!picked) return undefined;

    await setFlashLocation(picked);
    dest = picked;
  }

  // Case 2: set but missing → offer "Select New Location" or "Continue"
  if (!(await pathExists(dest))) {
    const selectNewLabel = vscode.l10n.t('Select New Location');
    const continueLabel = vscode.l10n.t('Continue');

    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('Device not found at {0}\n\n• Is the board plugged in?\n• Is the board in bootloader mode? (press RESET on the board)\n\nSelect "Continue" if the device appears after checking cable and pressing RESET.\n\nOtherwise, select a new location for the BAOCHIP device.', dest),
      { modal: true },
      selectNewLabel,
      continueLabel
    );

    if (choice === selectNewLabel) {
      const picked = await promptForFlashFolder();
      if (!picked) return undefined;
      await setFlashLocation(picked);
      dest = picked;

      if (!(await pathExists(dest))) {
        vscode.window.showErrorMessage(vscode.l10n.t('Selected location is not accessible: {0}', dest));
        return undefined;
      }
    } else if (choice === continueLabel) {
      const appeared = await waitForDrive(dest, 8000, 500);
      if (!appeared) {
        vscode.window.showErrorMessage(vscode.l10n.t('Drive did not appear at: {0}', dest));
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
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('Baochip: Flashing…'), cancellable: true },
    async (_progress, token) => {
      try {
        let copied = 0;
        const chan = vscode.window.createOutputChannel(vscode.l10n.t('Bao Flash'));
        chan.show(true);

        for (const srcPath of files) {
          if (token.isCancellationRequested) break;

          const fileName = path.basename(srcPath);
          const srcUri = vscode.Uri.file(srcPath);
          const dstUri = vscode.Uri.file(path.join(dest, fileName));

          // Compute MD5 hash
          const buf = fs.readFileSync(srcUri.fsPath);
          const md5 = crypto.createHash('md5').update(buf).digest('hex');

          chan.appendLine(`[bao] ${vscode.l10n.t('Flashing {0}', fileName)}`);
          chan.appendLine(`      ${vscode.l10n.t('MD5: {0}', md5)}`);

          await vscode.workspace.fs.copy(srcUri, dstUri, { overwrite: true });
          copied++;
        }

        if (token.isCancellationRequested) {
          vscode.window.showWarningMessage(vscode.l10n.t('Baochip: Flash cancelled.'));
          return false;
        }

        vscode.window.showInformationMessage(vscode.l10n.t('Baochip: flashed {0} file(s) to {1}.', copied, dest));
        chan.appendLine(`[bao] ${vscode.l10n.t('Flash complete ({0} file(s))', copied)}`);
        return true;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        vscode.window.showErrorMessage(vscode.l10n.t('Baochip flash failed: {0}', msg));
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
    vscode.window.showWarningMessage(vscode.l10n.t('No UF2s found (loader/xous/apps). Build first, then flash.'));
    return false;
  }

  return flashFiles(dest, all);
}
