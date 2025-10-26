import * as vscode from "vscode";
import { ensureXousCorePath, resolveBaoPy } from "@services/pathService";
import { getMonitorPort, getDefaultBaud, getPythonCmd } from "@services/configService";

let monitorTerm: vscode.Terminal | undefined;
const q = (s: string) => (/\s|["`]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);

export function registerOpenMonitor(context: vscode.ExtensionContext) {
  return vscode.commands.registerCommand("baochip.openMonitor", async () => {
    const port = getMonitorPort();
    if (!port) {
      vscode.window.showInformationMessage("No monitor port set. Pick one first.");
      await vscode.commands.executeCommand("baochip.setMonitorPort");
      return;
    }

    let root: string, bao: string;
    try { root = await ensureXousCorePath(); bao = await resolveBaoPy(); }
    catch (e: any) { vscode.window.showWarningMessage(e?.message || "xous-core / bao.py not set"); return; }

    const py = getPythonCmd();
    const baud = getDefaultBaud();

    // Read your new settings
    const cfg = vscode.workspace.getConfiguration("baochip.monitor");
    const useTs     = cfg.get<boolean>("timestamp", true);
    const useCrlf   = cfg.get<boolean>("crlf", true);
    const useRaw    = cfg.get<boolean>("raw", false);
    const useEcho   = cfg.get<boolean>("echo", false);      // see echo note below
    const rtscts    = cfg.get<boolean>("rtscts", false);
    const xonxoff   = cfg.get<boolean>("xonxoff", false);
    const dsrdtr    = cfg.get<boolean>("dsrdtr", false);

    const flags: string[] = [];
    if (useTs)   flags.push("--ts");
    if (useCrlf) flags.push("--crlf");
    if (useRaw)  flags.push("--raw");
    // Echo mapping: if your Python uses `--no-echo` to turn echo off:
    if (!useEcho) flags.push("--no-echo");
    if (rtscts)  flags.push("--rtscts");
    if (xonxoff) flags.push("--xonxoff");
    if (dsrdtr)  flags.push("--dsrdtr");

    try { monitorTerm?.dispose(); } catch {}
    monitorTerm = vscode.window.createTerminal({ name: `Bao Monitor (${port})`, cwd: root });

    const cmd = `${q(py)} ${q(bao)} monitor -p ${q(port)} -b ${baud} ${flags.join(" ")}`.trim();
    monitorTerm.sendText(cmd);
    monitorTerm.show();
  });
}
