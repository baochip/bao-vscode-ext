import { spawn } from 'child_process';

export async function listPorts(pythonCmd: string, baoPath: string, cwd?: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonCmd, [baoPath, 'ports'], { cwd });
    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('close', code => {
      if (code === 0) {
        const ports = out.split(/\r?\n/).map(l => l.split('\t')[0]).filter(Boolean);
        resolve(ports);
      } else {
        reject(new Error(err || `Exited ${code}`));
      }
    });
  });
}


export async function waitForPort(
  pythonCmd: string,
  baoPath: string,
  targetPort: string,
  opts?: { cwd?: string; timeoutMs?: number; intervalMs?: number }
): Promise<boolean> {
  const timeoutMs = opts?.timeoutMs ?? 20000;
  const intervalMs = opts?.intervalMs ?? 500;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const ports = await listPorts(pythonCmd, baoPath, opts?.cwd);
      if (ports.includes(targetPort)) return true;
    } catch {
      // ignore transient errors and keep polling
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}