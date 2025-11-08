import * as vscode from 'vscode';
import { runBaoCmd } from '@services/pathService';

export type BaoArtifact = {
  path: string;
  role?: 'loader' | 'xous' | 'apps';
};

export async function fetchArtifacts(
  cwd: string
): Promise<BaoArtifact[]> {
  const out = await runBaoCmd(['artifacts', '--json'], cwd, { capture: true });

  try {
    const parsed = JSON.parse(out);
    if (Array.isArray(parsed?.images)) return parsed.images as BaoArtifact[];
    if (Array.isArray(parsed)) return parsed as BaoArtifact[];
    return [];
  } catch {
    throw new Error(vscode.l10n.t('artifacts.parseFailed'));
  }
}
