import * as vscode from 'vscode';
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
    return undefined;
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

        for (const srcPath of files) {
          if (token.isCancellationRequested) break;

          const fileName = path.basename(srcPath);
          const srcUri = vscode.Uri.file(srcPath);
          const dstUri = vscode.Uri.file(path.join(dest, fileName));

          await vscode.workspace.fs.copy(srcUri, dstUri, { overwrite: true });
          copied++;
        }

        if (token.isCancellationRequested) {
          vscode.window.showWarningMessage('Baochip: Flash cancelled.');
          return false;
        }

        vscode.window.showInformationMessage(`Baochip: flashed ${copied} file(s) to ${dest}.`);
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
  if (!dest) return false; // path missing/cancelled → stop

  const { all } = await gatherArtifacts(root);
  if (all.length === 0) {
    vscode.window.showWarningMessage('No UF2s found (loader/xous/apps). Build first, then flash.');
    return false;
  }

  return flashFiles(dest, all);
}
