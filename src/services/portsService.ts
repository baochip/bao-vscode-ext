import type { } from 'child_process'; // keep file type-safe; no direct spawn needed

export async function listPorts(
  runBao: (args: string[], cwd?: string, opts?: { capture?: boolean }) => Promise<string>,
  cwd?: string
): Promise<string[]> {
  const out = await runBao(['ports'], cwd, { capture: true });
  // Support either plain lines or tab-separated fields (take the first column)
  return out
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => l.split('\t')[0])
    .filter(Boolean);
}

export async function waitForPort(
  runBao: (args: string[], cwd?: string, opts?: { capture?: boolean }) => Promise<string>,
  targetPort: string,
  opts?: { cwd?: string; timeoutMs?: number; intervalMs?: number }
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 20000;
  const intervalMs = opts?.intervalMs ?? 500;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const ports = await listPorts(runBao, opts?.cwd);
      if (ports.includes(targetPort)) return true;
    } catch {
      // ignore transient errors and keep polling
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}