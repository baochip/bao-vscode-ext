import * as vscode from 'vscode';

export const cfg = () => vscode.workspace.getConfiguration(''); // root

async function updateSetting<T>(key: string, value: T) {
	if (!vscode.workspace.workspaceFolders?.length) {
		throw new Error(
			vscode.l10n.t('Please open a folder or workspace before configuring Baochip settings.'),
		);
	}
	await cfg().update(key, value, vscode.ConfigurationTarget.Workspace);
}

export const getDefaultBaud = () => cfg().get<number>('baochip.monitor.defaultBaud') || 1000000;
export const setDefaultBaud = (baud: number) => updateSetting('baochip.monitor.defaultBaud', baud);

export const getMonitorDefaultPort = (): 'run' | 'bootloader' =>
	cfg().get<'run' | 'bootloader'>('baochip.monitorDefaultPort') ?? 'run';
export const setMonitorDefaultPort = (v: 'run' | 'bootloader') =>
	updateSetting('baochip.monitorDefaultPort', v);

export const getBootloaderSerialPort = (): string =>
	cfg().get<string>('baochip.serialPortBootloader') || '';
export const setBootloaderSerialPort = (port: string) =>
	updateSetting('baochip.serialPortBootloader', port);

export const getRunSerialPort = (): string => cfg().get<string>('baochip.serialPortRun') || '';
export const setRunSerialPort = (port: string) => updateSetting('baochip.serialPortRun', port);

export const getFlashLocation = () => cfg().get<string>('baochip.flashLocation') || '';
export const setFlashLocation = (p: string) => updateSetting('baochip.flashLocation', p);

export const getBuildTarget = () => cfg().get<string>('baochip.buildTarget') || '';
export const setBuildTarget = (t: string) => updateSetting('baochip.buildTarget', t);

export const getXousAppName = () => cfg().get<string>('baochip.xousAppName') || '';
export const setXousAppName = (n: string) => updateSetting('baochip.xousAppName', n);

export const getXousCorePath = () => cfg().get<string>('baochip.xousCorePath') || '';
export const setXousCorePath = (p: string) => updateSetting('baochip.xousCorePath', p);

export type BuildMode = 'auto' | 'xous-core' | 'out-of-tree';
export const getBuildMode = (): BuildMode => cfg().get<BuildMode>('baochip.buildMode') ?? 'auto';
export const setBuildMode = (mode: BuildMode) => updateSetting('baochip.buildMode', mode);

export const getExtraFeatures = (): string[] =>
	cfg().get<string[]>('baochip.outOfTree.extraFeatures') ?? [];

export const getMonitorFlags = () => ({
	crlf: cfg().get<boolean>('baochip.monitor.crlf') ?? true,
	raw: cfg().get<boolean>('baochip.monitor.raw') ?? true,
	echo: cfg().get<boolean>('baochip.monitor.echo') ?? false,
});

export const getKernelMode = (): string =>
	cfg().get<string>('baochip.outOfTree.kernelMode') ?? 'ask';
export const setKernelMode = (mode: 'ci-sync' | 'manual') =>
	updateSetting('baochip.outOfTree.kernelMode', mode);

export const getKernelFilesPath = () =>
	cfg().get<string>('baochip.outOfTree.kernelFilesPath') || '';
export const setKernelFilesPath = (p: string) =>
	updateSetting('baochip.outOfTree.kernelFilesPath', p);
