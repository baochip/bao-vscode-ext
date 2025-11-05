import * as vscode from 'vscode';
import { resolveBaoPy, ensureXousCorePath, ensurePythonCmd } from '@services/pathService';
import { listBuildTargets } from '@services/targetsService';
import { getBuildTarget, setBuildTarget, getBuildTargetsFallback } from '@services/configService';
import { gateToolsBao } from '@services/versionGate';

export function registerSelectBuildTarget(context: vscode.ExtensionContext, refreshUI: () => void) {
  return gateToolsBao('baochip.selectBuildTarget', async () => {
    let baoPath: string, cwd: string;
    try {
      baoPath = await resolveBaoPy();
      cwd = await ensureXousCorePath();
    } catch (e: any) {
      vscode.window.showWarningMessage(e?.message || 'xous-core path not set'); return;
    }

    const py = await ensurePythonCmd();
    let targets = await listBuildTargets(py, baoPath, cwd).catch(() => []);
    if (targets.length === 0) targets = getBuildTargetsFallback();
    if (targets.length === 0) { vscode.window.showWarningMessage('No build targets available.'); return; }

    const current = getBuildTarget();
    const picked = await vscode.window.showQuickPick(
      targets.map(t => ({ label: t, description: t === current ? 'current' : undefined })),
      { placeHolder: 'Select build target' }
    );
    if (!picked) return;

    await setBuildTarget(picked.label);
    vscode.window.showInformationMessage(`Build target set to ${picked.label}`);
    refreshUI();
  });
}
