import * as fs from 'node:fs';
import * as path from 'node:path';
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

// lightweight validator for UX
export function isLikelyValidAppName(name: string): boolean {
	return /^[a-z][a-z0-9_-]*$/.test(name); // lowercase, start with letter
}

const TEMPLATE_APP = 'helloworld';

function readWorkspaceMembers(xousRoot: string): string[] {
	const content = fs.readFileSync(path.join(xousRoot, 'Cargo.toml'), 'utf8');
	const m = content.match(/^members\s*=\s*\[([\s\S]*?)\]/m);
	if (!m) return [];
	return [...m[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function getPackageName(cargoTomlPath: string): string | null {
	try {
		const m = fs.readFileSync(cargoTomlPath, 'utf8').match(/^name\s*=\s*"([^"]+)"/m);
		return m ? m[1] : null;
	} catch {
		return null;
	}
}

function addWorkspaceMember(xousRoot: string, member: string): void {
	const cargoPath = path.join(xousRoot, 'Cargo.toml');
	const content = fs.readFileSync(cargoPath, 'utf8');
	// Insert new member before the closing ] of the members array (^ with m flag anchors to line start,
	// distinguishing `members` from `default-members`)
	const updated = content.replace(/(^members\s*=\s*\[[\s\S]*?)(\n\])/m, `$1\n  "${member}",$2`);
	fs.writeFileSync(cargoPath, updated, 'utf8');
}

export async function createBaoApp(xousRoot: string, appName: string): Promise<void> {
	const appsDir = path.join(xousRoot, APPS_DIRNAME);
	const templateDir = path.join(appsDir, TEMPLATE_APP);
	const templateCargo = path.join(templateDir, 'Cargo.toml');

	if (!fs.existsSync(templateCargo)) {
		throw new Error(`Template not found at: ${templateCargo}`);
	}

	// Check for package name collision across all workspace members
	const members = readWorkspaceMembers(xousRoot);
	for (const member of members) {
		const pkgName = getPackageName(path.join(xousRoot, member, 'Cargo.toml'));
		if (pkgName === appName) {
			throw new Error(`Package name "${appName}" already exists in workspace`);
		}
	}

	const newDir = path.join(appsDir, appName);
	if (fs.existsSync(newDir)) {
		throw new Error(`App directory already exists: ${newDir}`);
	}

	// Create app directory and copy Cargo.toml with renamed package
	fs.mkdirSync(newDir, { recursive: true });
	const newCargo = fs
		.readFileSync(templateCargo, 'utf8')
		.replace(/^(name\s*=\s*)"[^"]*"/m, `$1"${appName}"`);
	fs.writeFileSync(path.join(newDir, 'Cargo.toml'), newCargo, 'utf8');

	// Copy src/ from template, or write a minimal fallback
	const templateSrc = path.join(templateDir, 'src');
	const newSrc = path.join(newDir, 'src');
	if (fs.existsSync(templateSrc)) {
		fs.cpSync(templateSrc, newSrc, { recursive: true });
	} else {
		fs.mkdirSync(newSrc, { recursive: true });
		fs.writeFileSync(
			path.join(newSrc, 'main.rs'),
			'#![no_std]\n#![no_main]\nuse core::panic::PanicInfo;\n#[panic_handler] fn panic(_info: &PanicInfo) -> ! { loop {} }\n#[no_mangle] pub extern "C" fn main() -> ! { loop {} }\n',
			'utf8',
		);
	}

	// Register in workspace Cargo.toml
	addWorkspaceMember(xousRoot, `${APPS_DIRNAME}/${appName}`);

	try {
		await vscode.workspace.saveAll();
	} catch {}
}
