import * as vscode from 'vscode';

export const cfg = () => vscode.workspace.getConfiguration(''); // root

export const getXousCorePath = () => cfg().get<string>('baochip.xousCorePath') || '';
export const getPythonCmd = () => cfg().get<string>('baochip.pythonCommand') || 'python';
export const getDefaultBaud = () => cfg().get<number>('baochip.defaultBaud') || 115200;
export const getMonitorPort = () => cfg().get<string>('baochip.monitorPort') || '';
export const setMonitorPort = (p: string) => cfg().update('baochip.monitorPort', p, updateTarget());
export const setFlashPort = (p: string) => cfg().update('baochip.flashPort', p, updateTarget());
export const getFlashPort = () => cfg().get<string>('baochip.flashPort') || '';

export const getBuildTarget = () => cfg().get<string>('baochip.buildTarget') || '';
export const setBuildTarget = (t: string) => cfg().update('baochip.buildTarget', t, updateTarget());
export const getBuildTargetsFallback = () => (cfg().get<string[]>('baochip.buildTargets') || []);

export const getFlashMethod = () => cfg().get<string>('baochip.flashMethod') || '';
export const setFlashMethod = (m: string) => cfg().update('baochip.flashMethod', m, updateTarget());
export const getFlashMethodsFallback = () => cfg().get<string[]>('baochip.flashMethods') || ['UART', 'JTAG'];

export const getXousAppName    = () => cfg().get<string>('baochip.xousAppName') || '';
export const setXousAppName    = (n: string) => cfg().update('baochip.xousAppName', n, vscode.ConfigurationTarget.Workspace);

export const updateTarget = (): vscode.ConfigurationTarget =>
  vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
