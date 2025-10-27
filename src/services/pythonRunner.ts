import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

export function splitExeAndArgs(cmd: string): { exe: string; args: string[] } {
  const parts = cmd.trim().split(/\s+/).filter(Boolean);
  return { exe: parts[0], args: parts.slice(1) };
}

export function runPython(cmd: string, args: string[]): ChildProcessWithoutNullStreams {
  const { exe, args: pre } = splitExeAndArgs(cmd);
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
  return spawn(exe, [...pre, ...args], { env });
}
