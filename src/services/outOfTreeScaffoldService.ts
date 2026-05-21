import * as fs from 'node:fs';
import * as path from 'node:path';
import { isLikelyValidAppName } from '@services/appService';
import { fetchLatestXousCoreRev } from '@services/kernelService';
import { getExtensionRoot } from '@services/uvService';
import * as vscode from 'vscode';

function getTemplateDir(): string {
	return path.join(getExtensionRoot(), 'resources', 'templates', 'out-of-tree');
}

async function pickName(suggestion?: string): Promise<string | undefined> {
	const input = await vscode.window.showInputBox({
		title: vscode.l10n.t('New Out-of-Tree App Name'),
		prompt: vscode.l10n.t('Name for the new Baochip app'),
		value: suggestion,
		placeHolder: vscode.l10n.t('test_app'),
		validateInput: (val) => {
			const n = (val || '').trim().toLowerCase();
			if (!n) return vscode.l10n.t('App name is required');
			if (!isLikelyValidAppName(n))
				return vscode.l10n.t('Use lowercase letters, numbers, -, _; start with a letter');
			return null;
		},
	});
	return input ? input.trim().toLowerCase() : undefined;
}

async function pickParentFolder(): Promise<string | undefined> {
	const picked = await vscode.window.showOpenDialog({
		title: vscode.l10n.t('Select parent folder for new app'),
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: vscode.l10n.t('Create here'),
	});
	return picked?.[0]?.fsPath;
}

export async function scaffoldOutOfTreeApp(): Promise<void> {
	// Determine where to scaffold
	let projectDir: string;
	const openFolder = vscode.workspace.workspaceFolders?.[0];

	if (openFolder) {
		const useCurrentLabel = vscode.l10n.t('Use current folder: {0}', openFolder.uri.fsPath);
		const chooseDifferentLabel = vscode.l10n.t('Choose a different folder…');
		const choice = await vscode.window.showQuickPick([useCurrentLabel, chooseDifferentLabel], {
			title: vscode.l10n.t('Where should the project be created?'),
		});
		if (!choice) return;

		if (choice === useCurrentLabel) {
			const name = await pickName(path.basename(openFolder.uri.fsPath));
			if (!name) return;
			projectDir = openFolder.uri.fsPath;
			// Scaffold into the open folder, using name only for Cargo.toml package name
			return scaffoldInto(projectDir, name);
		} else {
			const parent = await pickParentFolder();
			if (!parent) return;
			const name = await pickName(path.basename(parent));
			if (!name) return;
			projectDir = path.join(parent, name);
			return scaffoldInto(projectDir, name);
		}
	} else {
		const parent = await pickParentFolder();
		if (!parent) return;
		const name = await pickName(path.basename(parent));
		if (!name) return;
		projectDir = path.join(parent, name);
		return scaffoldInto(projectDir, name);
	}
}

async function scaffoldInto(projectDir: string, name: string): Promise<void> {
	if (fs.existsSync(path.join(projectDir, 'Cargo.toml'))) {
		vscode.window.showErrorMessage(
			vscode.l10n.t('A Cargo.toml already exists in {0}.', projectDir),
		);
		return;
	}

	let rev: string;
	try {
		rev = await fetchLatestXousCoreRev();
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		vscode.window.showErrorMessage(
			vscode.l10n.t('Failed to fetch latest xous-core rev: {0}', message),
		);
		return;
	}

	try {
		const templateDir = getTemplateDir();

		const cargoContent = fs
			.readFileSync(path.join(templateDir, 'Cargo.toml'), 'utf8')
			.replace(/\{\{NAME\}\}/g, name)
			.replace(/\{\{REV\}\}/g, rev);

		fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
		fs.mkdirSync(path.join(projectDir, '.cargo'), { recursive: true });

		fs.writeFileSync(path.join(projectDir, 'Cargo.toml'), cargoContent, 'utf8');
		fs.copyFileSync(
			path.join(templateDir, 'src', 'main.rs'),
			path.join(projectDir, 'src', 'main.rs'),
		);
		fs.copyFileSync(
			path.join(templateDir, '.cargo', 'config.toml'),
			path.join(projectDir, '.cargo', 'config.toml'),
		);
	} catch (e: unknown) {
		const message = e instanceof Error ? e.message : String(e);
		vscode.window.showErrorMessage(vscode.l10n.t('Failed to create project: {0}', message));
		return;
	}

	const existingFolders = vscode.workspace.workspaceFolders ?? [];
	vscode.workspace.updateWorkspaceFolders(existingFolders.length, 0, {
		uri: vscode.Uri.file(projectDir),
		name,
	});
	vscode.window.showInformationMessage(
		vscode.l10n.t('Created out-of-tree app "{0}" at {1}.', name, projectDir),
	);
}
