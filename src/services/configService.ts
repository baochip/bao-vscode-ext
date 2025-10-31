import * as vscode from 'vscode';

export const cfg = () => vscode.workspace.getConfiguration(''); // root

async function updateSetting(key: string, value: any, target?: vscode.ConfigurationTarget) {
  // If target provided, use it. Otherwise pick Workspace if open, else Global.
  const hasWorkspace = !!vscode.workspace.workspaceFolders?.length;
  const t = target ?? (hasWorkspace ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global);
  await cfg().update(key, value, t);
}

export const getPythonCmd = () => cfg().get<string>('baochip.pythonCommand') || '';
export const getDefaultBaud = () => cfg().get<number>('baochip.monitor.defaultBaud') || 1000000;

export const getMonitorDefaultPort = (): "run" | "bootloader" => (cfg().get<string>('baochip.monitorDefaultPort') as any) || 'run';
export const setMonitorDefaultPort = (v: "run" | "bootloader") => updateSetting('baochip.monitorDefaultPort', v);

export const getBootloaderSerialPort = (): string => cfg().get<string>('baochip.serialPortBootloader') || '';
export const setBootloaderSerialPort = (port: string) => updateSetting('baochip.serialPortBootloader', port);

export const getRunSerialPort = (): string => cfg().get<string>('baochip.serialPortRun') || '';
export const setRunSerialPort = (port: string) => updateSetting('baochip.serialPortRun', port);

export const getFlashLocation = () => cfg().get<string>('baochip.flashLocation') || '';
export const setFlashLocation = (p: string) => updateSetting('baochip.flashLocation', p);

export const getBuildTarget = () => cfg().get<string>('baochip.buildTarget') || '';
export const setBuildTarget = (t: string) => cfg().update('baochip.buildTarget', t, updateTarget());
export const getBuildTargetsFallback = () => (cfg().get<string[]>('baochip.buildTargets') || []);

export const getXousAppName    = () => cfg().get<string>('baochip.xousAppName') || '';
export const setXousAppName    = (n: string) => cfg().update('baochip.xousAppName', n);

export const getXousCorePath = () => cfg().get<string>('baochip.xousCorePath') || '';
export const setXousCorePath = (p: string, target?: vscode.ConfigurationTarget) => updateSetting('baochip.xousCorePath', p, target);

export const updateTarget = (): vscode.ConfigurationTarget =>
  vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
