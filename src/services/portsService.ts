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
