import { spawn } from 'child_process';

export type UpdateAllResult = {
  updateAll: boolean;
  localSemver?: string;
  localTimestamp?: string;
  boardSemver?: string;
  boardTimestamp?: string;
};

export async function getUpdateAllInfo(
  pythonCmd: string,
  baoPath: string,
  cwd: string,
  port: string,
  baud: number
): Promise<UpdateAllResult> {
  return new Promise((resolve, reject) => {
    const args = [baoPath, 'update-all', '--json', '-p', port, '-b', String(baud)];
    const child = spawn(pythonCmd, args, { cwd });

    let out = '', err = '';
    child.stdout.on('data', d => out += d.toString());
    child.stderr.on('data', d => err += d.toString());
    child.on('close', code => {
      if (code !== 0) return reject(new Error(err || `update-all exited ${code}`));
      try {
        const parsed = JSON.parse(out);
        resolve({
          updateAll: !!parsed?.updateAll,
          localSemver: parsed?.localSemver,
          localTimestamp: parsed?.localTimestamp,
          boardSemver: parsed?.boardSemver,
          boardTimestamp: parsed?.boardTimestamp,
        });
      } catch {
        const s = out.trim().toLowerCase();
        if (s === 'true' || s === 'false') {
          resolve({ updateAll: s === 'true' });
        } else {
          reject(new Error('update-all parse failed'));
        }
      }
    });
  });
}
