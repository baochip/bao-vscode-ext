export const XOUS_TARGET_TRIPLE = 'riscv32imac-unknown-xous-elf';

/** Fallback board for an unrecognized target; the hardware target itself is always picked. */
export const DEFAULT_BUILD_TARGET = 'dabao';

/** Settings a target starts from when it is first selected; the user owns them afterwards. */
export type TargetSeed = {
	apps: string;
	features: string[];
	kernelFeatures: string[];
	buildFlags: string[];
};

type TargetInfo = {
	/** What the picker shows; the stored value is always the xtask target name. */
	label: string;
	appsDir: string;
	/** Not always board-<target>: the Defcon 34 badge builds with board-baosec. */
	boardFeature: string;
	/** Board types from the bootloader's 'boardtype' that belong to this target. */
	boardTypes: string[];
	/** Project modes that can build it. */
	modes: Array<'xous-core' | 'out-of-tree'>;
	seed?: TargetSeed;
};

const BOTH_MODES: TargetInfo['modes'] = ['xous-core', 'out-of-tree'];

const TARGETS: Record<string, TargetInfo> = {
	dabao: {
		label: 'dabao',
		appsDir: 'apps-dabao',
		boardFeature: 'board-dabao',
		boardTypes: ['dabao'],
		modes: BOTH_MODES,
	},
	baosec: {
		label: 'baosec',
		appsDir: 'apps-baosec',
		boardFeature: 'board-baosec',
		boardTypes: ['baosec'],
		modes: BOTH_MODES,
	},
	// Out-of-tree cannot build the badge: its crates come from the xous-core workspace.
	'baosec-lite': {
		label: 'Defcon 34 badge',
		appsDir: 'apps-baosec',
		boardFeature: 'board-baosec',
		boardTypes: ['baosec'],
		modes: ['xous-core'],
		seed: {
			apps: 'dc34-console~flash dc34-vault',
			features: ['usb'],
			kernelFeatures: ['debug-proc'],
			buildFlags: ['--no-timestamp', '--no-verify'],
		},
	},
};

export function getAppsDir(target: string): string {
	return TARGETS[target]?.appsDir ?? TARGETS[DEFAULT_BUILD_TARGET].appsDir;
}

export const ALL_APPS_DIRS = [...new Set(Object.values(TARGETS).map((t) => t.appsDir))];
export const BUILD_TARGETS = Object.keys(TARGETS);

/** What the target picker shows for a target. */
export function targetLabel(target: string): string {
	return TARGETS[target]?.label ?? target;
}

/** The cargo feature a target builds with. */
export function boardFeature(target: string): string {
	return TARGETS[target]?.boardFeature ?? `board-${target}`;
}

/** Whether this project mode can build the target. */
export function targetSupportsMode(target: string, mode: 'xous-core' | 'out-of-tree'): boolean {
	return TARGETS[target]?.modes.includes(mode) ?? true;
}

/** Targets this mode can build, in table order. */
export function targetsForMode(mode: 'xous-core' | 'out-of-tree'): string[] {
	return BUILD_TARGETS.filter((target) => targetSupportsMode(target, mode));
}

/** What a target starts from when first selected, if anything. */
export function targetSeed(target: string): TargetSeed | undefined {
	return TARGETS[target]?.seed;
}

/**
 * Whether a board type belongs to the selected target. Undefined when the reported type belongs
 * to no target we know - oem boards, or hardware newer than this table - which is not a mismatch,
 * just nothing to compare.
 */
export function boardTypeFitsTarget(boardType: string, target: string): boolean | undefined {
	const type = boardType.toLowerCase();
	const known = Object.values(TARGETS).some((t) => t.boardTypes.includes(type));
	if (!known) return undefined;
	return TARGETS[target]?.boardTypes.includes(type) ?? undefined;
}

export const XOUS_CORE_REPO = 'https://github.com/betrusted-io/xous-core';
