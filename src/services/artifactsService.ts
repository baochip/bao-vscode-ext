import * as fs from 'node:fs';
import * as path from 'node:path';
import { XOUS_TARGET_TRIPLE } from '@constants';
import { discoverOutOfTreeCrates, parseXousCoreRev } from '@util/cargo';
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

export type Uf2Role = NonNullable<BaoArtifact['role']>;

/** Images each target's build produces: dabao builds apps detached, baosec builds swap. */
const TARGET_IMAGES: Record<string, Uf2Role[]> = {
	dabao: ['loader', 'xous', 'apps'],
	baosec: ['loader', 'xous', 'swap'],
	'baosec-lite': ['loader', 'xous', 'swap'],
};

/** Images belonging to `target`, or every role for a target this version does not know yet. */
export function imagesForTarget(target: string): Uf2Role[] {
	return TARGET_IMAGES[target] ?? UF2_IMAGES.map((image) => image.role);
}

function releaseDir(xousRoot: string): string {
	return path.join(xousRoot, 'target', XOUS_TARGET_TRIPLE, 'release');
}

/** Images the board already carries; a build produces whatever else the target needs. */
const KERNEL_ROLES: Uf2Role[] = ['loader', 'xous'];

/** The image a build produces for `target`: apps.uf2 on dabao, swap.uf2 on baosec. */
export function projectImageName(target: string): string {
	const role = imagesForTarget(target).find((r) => !KERNEL_ROLES.includes(r));
	return UF2_IMAGES.find((image) => image.role === role)?.fileName ?? 'apps.uf2';
}

/** Where a build of `mode` writes the project image. */
export function projectImagePath(
	mode: 'xous-core' | 'out-of-tree',
	root: string,
	target: string,
): string {
	const name = projectImageName(target);
	return mode === 'out-of-tree' ? path.join(root, name) : path.join(releaseDir(root), name);
}

/** The xous-core revision this project pins, from its root or member manifests. */
function pinnedXousCoreRev(projectRoot: string): string | null {
	const manifests = [
		path.join(projectRoot, 'Cargo.toml'),
		...discoverOutOfTreeCrates(projectRoot).crates.map((crate) => crate.manifestPath),
	];
	for (const manifest of manifests) {
		try {
			const rev = parseXousCoreRev(fs.readFileSync(manifest, 'utf8'));
			if (rev) return rev;
		} catch {
			// unreadable manifest: try the next one
		}
	}
	return null;
}

/**
 * Extra xous-app-uf2 flags for `target`. A swap image is signed with the xous-core revision;
 * passing the pinned one keeps the tool from running git, which it does not survive failing.
 */
export function uf2ToolArgs(target: string, projectRoot: string): string[] {
	if (projectImageName(target) !== 'swap.uf2') return [];
	const rev = pinnedXousCoreRev(projectRoot);
	return rev ? ['--swap', '--git-rev', rev] : ['--swap'];
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
