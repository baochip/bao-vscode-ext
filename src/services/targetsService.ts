import { spawn } from 'child_process';

export async function listBuildTargets(pythonCmd: string, baoPath: string, cwd?: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonCmd, [baoPath, 'targets', '--json'], { cwd });
    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('close', code => {
      if (code === 0) {
        try {
          const obj = JSON.parse(out);
          const arr = Array.isArray(obj?.targets) ? obj.targets : [];
          resolve(arr);
        } catch {
          resolve([]); // fall back to empty, caller can use getBuildTargetsFallback()
        }
      } else {
        reject(new Error(err || `Exited ${code}`));
      }
    });
  });
}
