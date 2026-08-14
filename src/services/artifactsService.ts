import * as path from 'node:path';
import { XOUS_TARGET_TRIPLE } from '@constants';
import { isDirectory, isFile } from '@util/fsUtil';

export type BaoArtifact = {
	path: string;
	role?: 'loader' | 'xous' | 'apps' | 'swap';
};

const UF2_IMAGES: Array<{ fileName: string; role: NonNullable<BaoArtifact['role']> }> = [
	{ fileName: 'loader.uf2', role: 'loader' },
	{ fileName: 'xous.uf2', role: 'xous' },
	{ fileName: 'apps.uf2', role: 'apps' },
	{ fileName: 'swap.uf2', role: 'swap' },
];

function releaseDir(xousRoot: string): string {
	return path.join(xousRoot, 'target', XOUS_TARGET_TRIPLE, 'release');
}

/** Where a build of `mode` writes apps.uf2. */
export function appsUf2Path(mode: 'xous-core' | 'out-of-tree', root: string): string {
	return mode === 'out-of-tree'
		? path.join(root, 'apps.uf2')
		: path.join(releaseDir(root), 'apps.uf2');
}

export function scanArtifacts(xousRoot: string): BaoArtifact[] {
	const releaseDirPath = releaseDir(xousRoot);
	if (!isDirectory(releaseDirPath)) return [];

	const artifacts: BaoArtifact[] = [];
	for (const { fileName, role } of UF2_IMAGES) {
		const artifactPath = path.join(releaseDirPath, fileName);
		if (isFile(artifactPath)) {
			artifacts.push({ path: artifactPath, role });
		}
	}
	return artifacts;
}
