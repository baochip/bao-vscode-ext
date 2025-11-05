import * as vscode from "vscode";
import { ensureXousCorePath, ensurePythonCmd, resolveBaoPy } from "@services/pathService";
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
    const friendly = def === 'run' ? 'run mode' : 'bootloader mode';
    vscode.window.showInformationMessage(`No ${friendly} serial port set. Pick one first.`);
    await vscode.commands.executeCommand(def === 'run' ? "baochip.setRunSerialPort" : "baochip.setBootloaderSerialPort");
    return;
  }

  // 2) Resolve paths
  let root: string, bao: string;
  try {
    root = await ensureXousCorePath();
    bao = await resolveBaoPy();
  } catch (e: any) {
    vscode.window.showWarningMessage(e?.message ?? "xous-core / bao.py not set");
    return;
  }

  // 3) Settings -> flags
  const cfg = vscode.workspace.getConfiguration("baochip.monitor");
  const baud = getDefaultBaud();
  const flags: string[] = [];
  if (cfg.get<boolean>("crlf"))      flags.push("--crlf");
  if (cfg.get<boolean>("raw"))       flags.push("--raw");
  // Align with your CLI: if echo=false means pass '--no-echo':
  if (!cfg.get<boolean>("echo"))     flags.push("--no-echo");
  if (cfg.get<boolean>("rtscts"))    flags.push("--rtscts");
  if (cfg.get<boolean>("xonxoff"))   flags.push("--xonxoff");
  if (cfg.get<boolean>("dsrdtr"))    flags.push("--dsrdtr");

  const py = await ensurePythonCmd();
  const cmd = [
    q(py),
    q(bao),
    "monitor",
    "-p", q(port),
    "-b", String(baud),
    ...flags
  ].join(" ");

  // 4) Launch terminal
  try { monitorTerm?.dispose(); } catch {}
  const label = def === 'run' ? 'Run' : 'Bootloader';
  monitorTerm = vscode.window.createTerminal({
    name: `Bao Monitor (${label}: ${port})`,
    cwd: root
  });
  monitorTerm.sendText(cmd);
  monitorTerm.show();
}

export function stopMonitorTTY() {
  try { monitorTerm?.dispose(); } catch {}
  monitorTerm = undefined;
}


export async function openMonitorTTYOnMode(mode: 'run' | 'bootloader') {
  const port = mode === 'run' ? getRunSerialPort() : getBootloaderSerialPort();
  if (!port) {
    const friendly = mode === 'run' ? 'run-mode' : 'bootloader-mode';
    vscode.window.showInformationMessage(`No ${friendly} serial port set. Pick one first.`);
    await vscode.commands.executeCommand(mode === 'run' ? 'baochip.setRunSerialPort' : 'baochip.setBootloaderSerialPort');
    return;
  }

  // Resolve paths
  let root: string, bao: string;
  try { root = await ensureXousCorePath(); bao = await resolveBaoPy(); }
  catch (e: any) { vscode.window.showWarningMessage(e?.message ?? "xous-core / bao.py not set"); return; }

  const cfg = vscode.workspace.getConfiguration("baochip.monitor");
  const baud = getDefaultBaud();
  const flags: string[] = [];
  if (cfg.get<boolean>("crlf"))      flags.push("--crlf");
  if (cfg.get<boolean>("raw"))       flags.push("--raw");
  if (!cfg.get<boolean>("echo"))     flags.push("--no-echo");

  const py = await ensurePythonCmd();
  const cmd = [
    q(py), q(bao), "monitor",
    "-p", q(port),
    "-b", String(baud),
    ...flags
  ].join(" ");

  try { monitorTerm?.dispose(); } catch {}
  const label = mode === 'run' ? 'Run' : 'Bootloader';
  monitorTerm = vscode.window.createTerminal({ name: `Bao Monitor (${label}: ${port})`, cwd: root });
  monitorTerm.sendText(cmd);
  monitorTerm.show();
}