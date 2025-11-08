import * as vscode from "vscode";
import { ensureXousCorePath, resolveBaoPy, getBaoRunner } from "@services/pathService";
import { getRunSerialPort, getBootloaderSerialPort, getDefaultBaud, getMonitorDefaultPort } from "@services/configService";

let monitorTerm: vscode.Terminal | undefined;

function q(s: string) {
  return /\s|["`]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

export async function openMonitorTTY(context?: vscode.ExtensionContext) {
  // 1) Choose based on default
  const def = getMonitorDefaultPort(); // "run" | "bootloader"
  const port = def === 'run' ? getRunSerialPort() : getBootloaderSerialPort();

  if (!port) {
    const friendly = def === 'run' ? vscode.l10n.t('mode.run') : vscode.l10n.t('mode.bootloader');
    vscode.window.showInformationMessage(vscode.l10n.t('ports.noSerialPortSet', friendly));
    await vscode.commands.executeCommand(def === 'run' ? "baochip.setRunSerialPort" : "baochip.setBootloaderSerialPort");
    return;
  }

  // 2) Resolve paths
  let root: string, bao: string;
  try {
    root = await ensureXousCorePath();
    bao = await resolveBaoPy();
  } catch (e: any) {
    vscode.window.showWarningMessage(e?.message ?? vscode.l10n.t('prereq.xousOrBaoNotSet'));
    return;
  }

  // 3) Settings -> flags (do not localize CLI flags)
  const cfg = vscode.workspace.getConfiguration("baochip.monitor");
  const baud = getDefaultBaud();
  const flags: string[] = [];
  if (cfg.get<boolean>("crlf"))      flags.push("--crlf");
  if (cfg.get<boolean>("raw"))       flags.push("--raw");
  if (!cfg.get<boolean>("echo"))     flags.push("--no-echo");

  const { cmd, args } = await getBaoRunner(); // uv + ['run','python']
  const full = [
    q(cmd),
    ...args.map(q),
    q(bao),
    "monitor",
    "-p", q(port),
    "-b", String(baud),
    ...flags
  ].join(" ");

  // 4) Launch terminal
  try { monitorTerm?.dispose(); } catch {}
  const label = def === 'run' ? vscode.l10n.t('label.run') : vscode.l10n.t('label.bootloader');
  const termName = vscode.l10n.t('terminal.monitorTitleTemplate', label, port);
  monitorTerm = vscode.window.createTerminal({ name: termName, cwd: root });
  monitorTerm.sendText(full);
  monitorTerm.show();
}

export function stopMonitorTTY() {
  try { monitorTerm?.dispose(); } catch {}
  monitorTerm = undefined;
}

export async function openMonitorTTYOnMode(mode: 'run' | 'bootloader') {
  const port = mode === 'run' ? getRunSerialPort() : getBootloaderSerialPort();
  if (!port) {
    const friendly = mode === 'run' ? vscode.l10n.t('mode.run') : vscode.l10n.t('mode.bootloader');
    vscode.window.showInformationMessage(vscode.l10n.t('ports.noSerialPortSet', friendly));
    await vscode.commands.executeCommand(mode === 'run' ? 'baochip.setRunSerialPort' : 'baochip.setBootloaderSerialPort');
    return;
  }

  // Resolve paths
  let root: string, bao: string;
  try { root = await ensureXousCorePath(); bao = await resolveBaoPy(); }
  catch (e: any) { vscode.window.showWarningMessage(e?.message ?? vscode.l10n.t('prereq.xousOrBaoNotSet')); return; }

  const cfg = vscode.workspace.getConfiguration("baochip.monitor");
  const baud = getDefaultBaud();
  const flags: string[] = [];
  if (cfg.get<boolean>("crlf"))      flags.push("--crlf");
  if (cfg.get<boolean>("raw"))       flags.push("--raw");
  if (!cfg.get<boolean>("echo"))     flags.push("--no-echo");

  const { cmd, args } = await getBaoRunner();
  const full = [
    q(cmd), ...args.map(q), q(bao), "monitor",
    "-p", q(port),
    "-b", String(baud),
    ...flags
  ].join(" ");

  try { monitorTerm?.dispose(); } catch {}
  const label = mode === 'run' ? vscode.l10n.t('label.run') : vscode.l10n.t('label.bootloader');
  const termName = vscode.l10n.t('terminal.monitorTitleTemplate', label, port);
  monitorTerm = vscode.window.createTerminal({ name: termName, cwd: root });
  monitorTerm.sendText(full);
  monitorTerm.show();
}