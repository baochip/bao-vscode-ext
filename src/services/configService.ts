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
	const b = cfg().get<number>('monitor.defaultBaud');
	return typeof b === 'number' && b > 0 ? b : 1000000;
};
export const setDefaultBaud = (baud: number) => updateSetting('monitor.defaultBaud', baud);

export const getMonitorDefaultPort = (): 'run' | 'bootloader' =>
	cfg().get<'run' | 'bootloader'>('monitorDefaultPort') ?? 'run';
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
export const getExtraFeatures = (): string[] =>
	(cfg().get<string[]>('outOfTree.extraFeatures') ?? []).filter(isValidFeatureName);

export const getMonitorFlags = () => ({
	crlf: cfg().get<boolean>('monitor.crlf') ?? true,
	raw: cfg().get<boolean>('monitor.raw') ?? true,
	echo: cfg().get<boolean>('monitor.echo') ?? false,
});

export const getKernelMode = (): string => {
	const m = cfg().get<string>('outOfTree.kernelMode');
	return m === 'ci-sync' || m === 'manual' ? m : 'ask';
};
export const setKernelMode = (mode: 'ci-sync' | 'manual') =>
	updateSetting('outOfTree.kernelMode', mode);

export const getKernelFilesPath = () => cfg().get<string>('outOfTree.kernelFilesPath') || '';
export const setKernelFilesPath = (p: string) => updateSetting('outOfTree.kernelFilesPath', p);
