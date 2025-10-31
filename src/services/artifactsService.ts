import { spawn } from 'child_process';

export type BaoArtifact = {
  path: string;
  role?: 'loader' | 'xous' | 'apps';
}

export async function fetchArtifacts(
  pythonCmd: string,
  baoPath: string,
  cwd: string
): Promise<BaoArtifact[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonCmd, [baoPath, 'artifacts', '--json'], { cwd });

    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('close', code => {
      if (code !== 0) return reject(new Error(err || `artifacts exited ${code}`));
      try {
        const parsed = JSON.parse(out);
        resolve(Array.isArray(parsed?.images) ? parsed.images : []);
      } catch {
        reject(new Error('artifacts JSON parse failed'));
      }
    });
  });
}
