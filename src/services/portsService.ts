import { runPython } from './pythonRunner';

export async function listPorts(pythonCmd: string, baoPath: string): Promise<string[]> {
  return new Promise((resolve) => {
    const child = runPython(pythonCmd, [baoPath, 'ports']);
    let out = '';
    child.stdout.on('data', d => out += d.toString());
    child.on('close', code => {
      if (code === 0) {
        resolve(out.split(/\r?\n/).map(l => l.split('\t')[0]).filter(Boolean));
      } else {
        resolve([]); // treat non-zero as "no ports"
      }
    });
  });
}
