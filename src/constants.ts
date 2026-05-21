export const XOUS_TARGET_TRIPLE = 'riscv32imac-unknown-xous-elf';

const APPS_DIRS: Record<string, string> = {
	dabao: 'apps-dabao',
	baosec: 'apps-baosec',
};

export function getAppsDir(target: string): string {
	return APPS_DIRS[target] ?? 'apps-dabao';
}

export const ALL_APPS_DIRS = Object.values(APPS_DIRS);
