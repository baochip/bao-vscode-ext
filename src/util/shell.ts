/** Build a `cd` command that safely quotes the target directory for the platform's shell. */
export function shellCd(dir: string, platform: NodeJS.Platform = process.platform): string {
	if (platform === 'win32') return `cd "${dir}"`;
	return `cd '${dir.replace(/'/g, "'\\''")}'`;
}
