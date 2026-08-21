import { BUILD_TARGETS } from '@constants';
import { getBuildTarget, setBuildTarget } from '@services/configService';
import * as vscode from 'vscode';

/**
 * Return the hardware target to work with, prompting once when the user has not picked one.
 * Returns undefined when the pick is cancelled, or when a hand-edited setting names no known board.
 */
export async function ensureBuildTarget(): Promise<string | undefined> {
	const target = getBuildTarget();
	if (!target) return promptAndSaveBuildTarget();
	// A hand-edited baochip.buildTarget flows into `cargo xtask <target>` (argv, shell:false - not
	// shell injection, but argument injection); whitelist it like the terminal build paths do.
	if (!BUILD_TARGETS.includes(target)) {
		vscode.window.showErrorMessage(vscode.l10n.t('Invalid hardware target: {0}', target));
		return undefined;
	}
	return target;
}

/** Prompt the user to pick a hardware target, persist it, and return it (or undefined if cancelled). */
export async function promptAndSaveBuildTarget(): Promise<string | undefined> {
	const current = getBuildTarget();
	const picked = await vscode.window.showQuickPick(
		BUILD_TARGETS.map((t) => ({
			label: t,
			description: t === current ? vscode.l10n.t('current') : undefined,
		})),
		{ placeHolder: vscode.l10n.t('Select hardware target') },
	);
	if (!picked) return undefined;

	await setBuildTarget(picked.label);
	vscode.window.showInformationMessage(vscode.l10n.t('Hardware target set to: {0}', picked.label));
	return picked.label;
}
