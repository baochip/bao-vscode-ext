import { runPython } from '@services/pythonRunner';

export async function listBuildTargets(pythonCmd: string, baoPath: string): Promise<string[]> {
  return new Promise((resolve) => {
    const child = runPython(pythonCmd, [baoPath, 'targets']); // plain text: one per line
    let out = '';
    child.stdout.on('data', d => out += d.toString());
    child.on('close', code => {
      if (code === 0) {
        const items = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        resolve(items);
      } else {
        resolve([]); // fall back later
      }
    });
  });
}
