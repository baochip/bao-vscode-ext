import { warn } from '@services/logService';
import { isValidFeatureName } from '@util/cargo';
import * as vscode from 'vscode';

export const cfg = () => vscode.workspace.getConfiguration('baochip'); // scoped to the baochip.* section

async function updateSetting<T>(key: string, value: T) {
	if (!vscode.workspace.workspaceFolders?.length) {
		throw new Error(
			vscode.l10n.t('Please open a folder or workspace before configuring Baochip settings.'),
		);
	}
	await cfg().update(key, value, vscode.ConfigurationTarget.Workspace);
}

export const getDefaultBaud = () => {
	// Integer-only: bao.py's argparse uses type=int, so a hand-edited float would crash the
	// monitor/boot command. Fall back to the default rather than pass a value it will reject.
	const b = cfg().get<number>('monitor.defaultBaud');
	return typeof b === 'number' && Number.isInteger(b) && b > 0 ? b : 1000000;
};
export const setDefaultBaud = (baud: number) => updateSetting('monitor.defaultBaud', baud);

export const getMonitorDefaultPort = (): 'run' | 'bootloader' => {
	// validate like getKernelMode: a hand-edited value must not slip through the typed cast
	const v = cfg().get<string>('monitorDefaultPort');
	return v === 'bootloader' ? 'bootloader' : 'run';
};
export const setMonitorDefaultPort = (v: 'run' | 'bootloader') =>
	updateSetting('monitorDefaultPort', v);

export const getBootloaderSerialPort = (): string =>
	cfg().get<string>('serialPortBootloader') || '';
export const setBootloaderSerialPort = (port: string) =>
	updateSetting('serialPortBootloader', port);

export const getRunSerialPort = (): string => cfg().get<string>('serialPortRun') || '';
export const setRunSerialPort = (port: string) => updateSetting('serialPortRun', port);

export const getFlashLocation = () => cfg().get<string>('flashLocation') || '';
export const setFlashLocation = (p: string) => updateSetting('flashLocation', p);

export const getBuildTarget = () => cfg().get<string>('buildTarget') || '';
export const setBuildTarget = (t: string) => updateSetting('buildTarget', t);

export const getXousAppName = () => cfg().get<string>('xousAppName') || '';
export const setXousAppName = (n: string) => updateSetting('xousAppName', n);

export const getXousCorePath = () => cfg().get<string>('xousCorePath') || '';
export const setXousCorePath = (p: string) => updateSetting('xousCorePath', p);

export type BuildMode = 'auto' | 'xous-core' | 'out-of-tree';
export const getBuildMode = (): BuildMode => cfg().get<BuildMode>('buildMode') ?? 'auto';
export const setBuildMode = (mode: BuildMode) => updateSetting('buildMode', mode);

// Only pass through values that look like cargo feature names (defense-in-depth for CLI args).
export const getExtraFeatures = (): string[] => {
	const all = cfg().get<string[]>('outOfTree.extraFeatures') ?? [];
	const valid = all.filter(isValidFeatureName);
	if (valid.length < all.length) {
		const dropped = all.filter((f) => !isValidFeatureName(f));
		warn(vscode.l10n.t('Ignoring invalid extra cargo features: {0}', dropped.join(', ')));
	}
	return valid;
};

export const getMonitorFlags = () => ({
	crlf: cfg().get<boolean>('monitor.crlf') ?? true,
	raw: cfg().get<boolean>('monitor.raw') ?? true,
	echo: cfg().get<boolean>('monitor.echo') ?? false,
});

/** Kernel-file sourcing modes a user can choose; 'ask' (not part of this type) means unchosen. */
export type KernelMode = 'ci-sync' | 'manual';

export const getKernelMode = (): KernelMode | 'ask' => {
	const m = cfg().get<string>('outOfTree.kernelMode');
	return m === 'ci-sync' || m === 'manual' ? m : 'ask';
};
export const setKernelMode = (mode: KernelMode) => updateSetting('outOfTree.kernelMode', mode);

export const getKernelFilesPath = () => cfg().get<string>('outOfTree.kernelFilesPath') || '';
export const setKernelFilesPath = (p: string) => updateSetting('outOfTree.kernelFilesPath', p);

// Application-scoped setting: reads/writes Global (not per-workspace), so the welcome preference is
// shared across all workspaces rather than re-prompting in each one.
export const getShowWelcome = (): boolean => cfg().get<boolean>('showWelcomeOnStartup', true);
export const setShowWelcome = (show: boolean) =>
	cfg().update('showWelcomeOnStartup', show, vscode.ConfigurationTarget.Global);
