export const XOUS_TARGET_TRIPLE = 'riscv32imac-unknown-xous-elf';

/** Fallback board for an unrecognized target; the hardware target itself is always picked. */
export const DEFAULT_BUILD_TARGET = 'dabao';

const APPS_DIRS: Record<string, string> = {
	dabao: 'apps-dabao',
	baosec: 'apps-baosec',
};

export function getAppsDir(target: string): string {
	return APPS_DIRS[target] ?? APPS_DIRS[DEFAULT_BUILD_TARGET];
}

export const ALL_APPS_DIRS = Object.values(APPS_DIRS);
export const BUILD_TARGETS = Object.keys(APPS_DIRS);

// Board types the bootloader reports from 'boardtype', mapped to the hardware target they mean.
// Anything absent here (oem, or a board newer than this table) is not comparable and is ignored.
const BOARD_TYPE_TARGETS: Record<string, string> = {
	dabao: 'dabao',
	baosec: 'baosec',
};

/** The hardware target a reported board type corresponds to, or undefined when there is no mapping. */
export function targetForBoardType(boardType: string): string | undefined {
	return BOARD_TYPE_TARGETS[boardType.toLowerCase()];
}

export const XOUS_CORE_REPO = 'https://github.com/betrusted-io/xous-core';
