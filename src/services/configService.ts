import * as vscode from 'vscode';

export const cfg = () => vscode.workspace.getConfiguration(''); // root

async function updateSetting(key: string, value: any) {
  await cfg().update(key, value, vscode.ConfigurationTarget.Workspace);
}

export const getDefaultBaud = () => cfg().get<number>('baochip.monitor.defaultBaud') || 1000000;

export const getMonitorDefaultPort = (): 'run' | 'bootloader' => (cfg().get<string>('baochip.monitorDefaultPort') as any) || 'run';
export const setMonitorDefaultPort = (v: 'run' | 'bootloader') => updateSetting('baochip.monitorDefaultPort', v);

export const getBootloaderSerialPort = (): string => cfg().get<string>('baochip.serialPortBootloader') || '';
export const setBootloaderSerialPort = (port: string) => updateSetting('baochip.serialPortBootloader', port);

export const getRunSerialPort = (): string => cfg().get<string>('baochip.serialPortRun') || '';
export const setRunSerialPort = (port: string) => updateSetting('baochip.serialPortRun', port);

export const getFlashLocation = () => cfg().get<string>('baochip.flashLocation') || '';
export const setFlashLocation = (p: string) => updateSetting('baochip.flashLocation', p);

export const getBuildTarget = () => cfg().get<string>('baochip.buildTarget') || '';
export const setBuildTarget = (t: string) => updateSetting('baochip.buildTarget', t);
export const getBuildTargetsFallback = () => cfg().get<string[]>('baochip.buildTargets') || [];

export const getXousAppName    = () => cfg().get<string>('baochip.xousAppName') || '';
export const setXousAppName    = (n: string) => updateSetting('baochip.xousAppName', n);

export const getXousCorePath = () => cfg().get<string>('baochip.xousCorePath') || '';
export const setXousCorePath = (p: string) => updateSetting('baochip.xousCorePath', p);
