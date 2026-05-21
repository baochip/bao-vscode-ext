import * as fs from 'node:fs';
import * as path from 'node:path';
import { getAppsDir } from '@constants';
import { runBaoCmd } from '@services/pathService';

export async function listBaoApps(xousRoot: string, target: string): Promise<string[]> {
	const appsDir = path.join(xousRoot, getAppsDir(target));
	if (!fs.existsSync(appsDir) || !fs.statSync(appsDir).isDirectory()) return [];
	const entries = fs.readdirSync(appsDir, { withFileTypes: true });
	return entries
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((name) => fs.existsSync(path.join(appsDir, name, 'Cargo.toml')))
		.sort((a, b) => a.localeCompare(b));
}

export function missingApps(xousRoot: string, appNames: string, target: string): string[] {
	const appsDir = path.join(xousRoot, getAppsDir(target));
	return appNames
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.filter((n) => {
			const dir = path.join(appsDir, n);
			return !(
				fs.existsSync(dir) &&
				fs.statSync(dir).isDirectory() &&
				fs.existsSync(path.join(dir, 'Cargo.toml'))
			);
		});
}

export function appExists(xousRoot: string, appNames: string, target: string): boolean {
	return missingApps(xousRoot, appNames, target).length === 0;
}

// lightweight validator for UX
export function isLikelyValidAppName(name: string): boolean {
	return /^[a-z][a-z0-9_-]*$/.test(name); // lowercase, start with letter
}

export async function createBaoApp(
	xousRoot: string,
	appName: string,
	target: string,
): Promise<void> {
	await runBaoCmd([
		'app',
		'create',
		'--xous-root',
		xousRoot,
		'--name',
		appName,
		'--target',
		target,
	]);
}
