import * as vscode from "vscode";
import { ensureXousCorePath, resolveBaoPy } from "@services/pathService";
import { getMonitorPort, getDefaultBaud, getPythonCmd } from "@services/configService";

let monitorTerm: vscode.Terminal | undefined;

function q(s: string) {
  // Safe enough for PowerShell/CMD/Bash
  return /\s|["`]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

export async function openMonitorTTY(context?: vscode.ExtensionContext) {
  const port = getMonitorPort();
  if (!port) {
    vscode.window.showInformationMessage("No port set. Pick one first.");
    await vscode.commands.executeCommand("baochip.setMonitorPort");
    return;
  }

  // Resolve paths
  let root: string, bao: string;
  try {
    root = await ensureXousCorePath();
    bao = await resolveBaoPy();
  } catch (e: any) {
    vscode.window.showWarningMessage(e?.message ?? "xous-core / bao.py not set");
    return;
  }

  // Settings -> flags
  const cfg = vscode.workspace.getConfiguration("baochip.monitor");
  const baud = getDefaultBaud();
  const flags: string[] = [];
  if (cfg.get<boolean>("timestamp")) flags.push("--ts");
  if (cfg.get<boolean>("crlf")) flags.push("--crlf");
  if (cfg.get<boolean>("raw")) flags.push("--raw");
  if (cfg.get<boolean>("echo")) flags.push("--echo");
  if (cfg.get<boolean>("rtscts")) flags.push("--rtscts");
  if (cfg.get<boolean>("xonxoff")) flags.push("--xonxoff");
  if (cfg.get<boolean>("dsrdtr")) flags.push("--dsrdtr");

  const py = getPythonCmd();
  const cmd = [
    q(py),
    q(bao),
    "monitor",
    "-p", q(port),
    "-b", String(baud),
    ...flags
  ].join(" ");

  try { monitorTerm?.dispose(); } catch {}
  monitorTerm = vscode.window.createTerminal({
    name: `Bao Monitor (${port})`,
    cwd: root
  });
  monitorTerm.sendText(cmd);
  monitorTerm.show();
}

export function stopMonitorTTY() {
  try { monitorTerm?.dispose(); } catch {}
  monitorTerm = undefined;
}
