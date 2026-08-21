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

export const XOUS_CORE_REPO = 'https://github.com/betrusted-io/xous-core';
