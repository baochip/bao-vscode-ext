/**
 * Parse the output of `bao.py ports` into port names. Supports plain lines or
 * tab-separated fields (the port is the first column); blank lines are dropped.
 */
export function parsePortsOutput(out: string): string[] {
	return out
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => l.split('\t')[0])
		.filter(Boolean);
}
