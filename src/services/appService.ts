import * as fs from 'node:fs';
import * as path from 'node:path';
import { runBaoCmd } from '@services/pathService';
import * as vscode from 'vscode';

const APPS_DIRNAME = 'apps-dabao';

export async function listBaoApps(xousRoot: string): Promise<string[]> {
	const appsDir = path.join(xousRoot, APPS_DIRNAME);
	if (!fs.existsSync(appsDir) || !fs.statSync(appsDir).isDirectory()) return [];
	const entries = fs.readdirSync(appsDir, { withFileTypes: true });
	return entries
		.filter((e) => e.isDirectory())
		.map((e) => e.name)
		.filter((name) => fs.existsSync(path.join(appsDir, name, 'Cargo.toml')))
		.sort((a, b) => a.localeCompare(b));
}

export function appExists(xousRoot: string, appNames: string): boolean {
	const appsDir = path.join(xousRoot, APPS_DIRNAME);
	const names = appNames.trim().split(/\s+/).filter(Boolean);
	if (names.length === 0) return false;

	return names.every((n) => {
		const dir = path.join(appsDir, n);
		return (
			fs.existsSync(dir) &&
			fs.statSync(dir).isDirectory() &&
			fs.existsSync(path.join(dir, 'Cargo.toml'))
		);
	});
}

export function missingApps(xousRoot: string, appNames: string): string[] {
	const appsDir = path.join(xousRoot, APPS_DIRNAME);
	const names = appNames.trim().split(/\s+/).filter(Boolean);
	const missing: string[] = [];
	for (const n of names) {
		const dir = path.join(appsDir, n);
		const ok =
			fs.existsSync(dir) &&
			fs.statSync(dir).isDirectory() &&
			fs.existsSync(path.join(dir, 'Cargo.toml'));
		if (!ok) missing.push(n);
	}
	return missing;
}

// lightweight validator for UX; final validation happens in tools-bao
export function isLikelyValidAppName(name: string): boolean {
	return /^[a-z][a-z0-9_-]*$/.test(name); // lowercase, start with letter
}

// Use tools-bao to create the app
export async function createBaoAppViaCli(xousRoot: string, appName: string): Promise<void> {
	try {
		await runBaoCmd(['app', 'create', '--xous-root', xousRoot, '--name', appName], xousRoot, {
			capture: false,
		});
	} catch (e: unknown) {
		const msg = (e instanceof Error ? e.message : String(e)).trim();
		throw new Error(msg);
	}

	try {
		await vscode.workspace.saveAll();
	} catch {}
}
