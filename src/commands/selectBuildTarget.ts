import * as vscode from 'vscode';
import { getBuildTarget, setBuildTarget, getBuildTargetsFallback } from '@services/configService';
import { gateToolsBao } from '@services/versionGate';

export function registerSelectBuildTarget(context: vscode.ExtensionContext, refreshUI: () => void) {
  return gateToolsBao('baochip.selectBuildTarget', async () => {
    const targets = getBuildTargetsFallback();
    if (!targets || targets.length === 0) {
      vscode.window.showWarningMessage('No build targets available.');
      return;
    }

    const current = getBuildTarget();
    const picked = await vscode.window.showQuickPick(
      targets.map(t => ({
        label: t,
        description: t === current ? 'current' : undefined,
      })),
      { placeHolder: 'Select build target' }
    );

    if (!picked) return;

    await setBuildTarget(picked.label);
    vscode.window.showInformationMessage(`Build target set to ${picked.label}`);
    refreshUI();
  });
}
