import * as vscode from 'vscode';

export const cfg = () => vscode.workspace.getConfiguration(''); // root
export const getBaoPath   = () => cfg().get<string>('baochip.baoPath') || '';
export const getPythonCmd = () => cfg().get<string>('baochip.pythonCommand') || 'python';
export const getDefaultBaud = () => cfg().get<number>('baochip.defaultBaud') || 115200;
export const getMonitorPort = () => cfg().get<string>('baochip.monitorPort') || '';
export const getFlashPort = () => cfg().get<string>('baochip.flashPort') || '';


export const updateTarget = (): vscode.ConfigurationTarget =>
  vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;

export const setBaoPath   = (p: string) => cfg().update('baochip.baoPath', p, updateTarget());
export const setMonitorPort = (p: string) => cfg().update('baochip.monitorPort', p, updateTarget());
export const setFlashPort = (p: string) => cfg().update('baochip.flashPort', p, updateTarget());