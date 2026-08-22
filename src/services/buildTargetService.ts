import {
	BUILD_TARGETS,
	type TargetSeed,
	targetLabel,
	targetSeed,
	targetSupportsMode,
	targetsForMode,
} from '@constants';
import {
	getBuildTarget,
	getInTreeBuildFlags,
	getInTreeFeatures,
	getInTreeKernelFeatures,
	getXousAppName,
	setBuildTarget,
	setInTreeBuildFlags,
	setInTreeFeatures,
	setInTreeKernelFeatures,
	setXousAppName,
} from '@services/configService';
import { getProjectMode } from '@services/projectModeService';
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
	// Settings follow you between projects, so a target picked elsewhere can be one this project
	// cannot build - the badge is built from a xous-core checkout only.
	const mode = getProjectMode();
	if (!targetSupportsMode(target, mode)) {
		vscode.window.showWarningMessage(
			vscode.l10n.t(
				'{0} cannot be built in this project. Pick another hardware target.',
				targetLabel(target),
			),
		);
		return promptAndSaveBuildTarget();
	}
	return target;
}

type SeedChoice = 'everything' | 'apps-only' | 'cancel';

/** Nothing of what this target seeds has been set yet, so filling it in takes nothing away. */
function seedSettingsAreEmpty(): boolean {
	return (
		getXousAppName().trim().length === 0 &&
		getInTreeFeatures().length === 0 &&
		getInTreeKernelFeatures().length === 0 &&
		getInTreeBuildFlags().length === 0
	);
}

/** Ask what to do about settings the user already has. Cancel abandons the target change too. */
async function askAboutSeeding(target: string): Promise<SeedChoice> {
	if (seedSettingsAreEmpty()) return 'everything';

	const everything = { title: vscode.l10n.t('Replace') };
	const appsOnly = { title: vscode.l10n.t('App list only') };
	const cancel = { title: vscode.l10n.t('Cancel'), isCloseAffordance: true };
	const answer = await vscode.window.showWarningMessage(
		vscode.l10n.t(
			'{0} uses a specific app list and build settings. Replace your current ones?',
			targetLabel(target),
		),
		{
			modal: true,
			detail: vscode.l10n.t(
				'You can edit them afterwards in the Baochip extension settings:\n- Xous App Name\n- In Tree: Features\n- In Tree: Kernel Features\n- In Tree: Build Flags',
			),
		},
		everything,
		appsOnly,
		cancel,
	);

	if (answer === everything) return 'everything';
	if (answer === appsOnly) return 'apps-only';
	return 'cancel';
}

/** Write the values a target starts from, as far as the user allowed. */
async function applySeed(seed: TargetSeed, choice: Exclude<SeedChoice, 'cancel'>): Promise<void> {
	await setXousAppName(seed.apps);
	if (choice === 'apps-only') return;
	await setInTreeFeatures(seed.features);
	await setInTreeKernelFeatures(seed.kernelFeatures);
	await setInTreeBuildFlags(seed.buildFlags);
}

/** Prompt the user to pick a hardware target, persist it, and return it (or undefined if cancelled). */
export async function promptAndSaveBuildTarget(): Promise<string | undefined> {
	const current = getBuildTarget();
	const offered = targetsForMode(getProjectMode());
	const picked = await vscode.window.showQuickPick(
		offered.map((target) => ({
			label: targetLabel(target),
			target,
			description: target === current ? vscode.l10n.t('current') : undefined,
		})),
		{ placeHolder: vscode.l10n.t('Select hardware target') },
	);
	if (!picked) return undefined;

	// Ask before changing anything: cancelling here leaves the target alone too, rather than
	// switching the board and leaving another target's app list behind.
	const seed = targetSeed(picked.target);
	const choice = seed ? await askAboutSeeding(picked.target) : 'everything';
	if (choice === 'cancel') return undefined;

	await setBuildTarget(picked.target);
	if (seed) await applySeed(seed, choice);
	vscode.window.showInformationMessage(vscode.l10n.t('Hardware target set to: {0}', picked.label));
	return picked.target;
}
