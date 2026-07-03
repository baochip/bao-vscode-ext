import * as path from 'node:path';
import { XOUS_TARGET_TRIPLE } from '@constants';
import { isDirectory, isFile } from '@util/fsUtil';

export type BaoArtifact = {
	path: string;
	role?: 'loader' | 'xous' | 'apps';
};

const UF2_IMAGES: Array<{ fileName: string; role: NonNullable<BaoArtifact['role']> }> = [
	{ fileName: 'loader.uf2', role: 'loader' },
	{ fileName: 'xous.uf2', role: 'xous' },
	{ fileName: 'apps.uf2', role: 'apps' },
];

export function scanArtifacts(xousRoot: string): BaoArtifact[] {
	const releaseDir = path.join(xousRoot, 'target', XOUS_TARGET_TRIPLE, 'release');
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
