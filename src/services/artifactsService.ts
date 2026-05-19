import * as fs from 'node:fs';
import * as path from 'node:path';

export type BaoArtifact = {
	path: string;
	role?: 'loader' | 'xous' | 'apps';
};

const TRIPLE = 'riscv32imac-unknown-xous-elf';
const UF2_IMAGES: Array<{ fileName: string; role: NonNullable<BaoArtifact['role']> }> = [
	{ fileName: 'loader.uf2', role: 'loader' },
	{ fileName: 'xous.uf2', role: 'xous' },
	{ fileName: 'apps.uf2', role: 'apps' },
];

function isFile(absPath: string): boolean {
	try {
		return fs.statSync(absPath).isFile();
	} catch {
		return false;
	}
}

function isDirectory(absPath: string): boolean {
	try {
		return fs.statSync(absPath).isDirectory();
	} catch {
		return false;
	}
}

export function scanArtifacts(xousRoot: string): BaoArtifact[] {
	const releaseDir = path.join(xousRoot, 'target', TRIPLE, 'release');
	if (!isDirectory(releaseDir)) return [];

	const artifacts: BaoArtifact[] = [];
	for (const { fileName, role } of UF2_IMAGES) {
		const artifactPath = path.join(releaseDir, fileName);
		if (isFile(artifactPath)) {
			artifacts.push({ path: artifactPath, role });
		}
	}
	return artifacts;
}

export async function fetchArtifacts(cwd: string): Promise<BaoArtifact[]> {
	return scanArtifacts(cwd);
}
