import * as fs from 'node:fs';
import * as path from 'node:path';
import { getBuildTargetOrDefault } from '@services/configService';
import { fetchLatestXousCoreRev, toastRevFetchFailed } from '@services/kernelService';
import { errorToast } from '@services/logService';
import { getExtensionRoot } from '@services/uvService';
import { isLikelyValidAppName } from '@util/appName';
import { toMessage } from '@util/error';
import { hasCargoToml, isSameOrParentPath } from '@util/fsUtil';
import * as vscode from 'vscode';

function getTemplateDir(target: string): string {
	return path.join(getExtensionRoot(), 'resources', 'templates', 'out-of-tree', target);
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
		title: vscode.l10n.t('Select project folder'),
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
		openLabel: vscode.l10n.t('Use this folder'),
	});
	return picked?.[0]?.fsPath;
}

export async function scaffoldOutOfTreeApp(): Promise<void> {
	// Determine where to scaffold
	let projectDir: string;
	const openFolder = vscode.workspace.workspaceFolders?.[0];

	if (openFolder) {
		const useCurrentLabel = vscode.l10n.t('Use current folder: {0}', openFolder.uri.fsPath);
		const chooseDifferentLabel = vscode.l10n.t('Choose a different folder...');
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
			const picked = await pickParentFolder();
			if (!picked) return;
			const name = await pickName(path.basename(picked));
			if (!name) return;
			return scaffoldInto(picked, name);
		}
	} else {
		const picked = await pickParentFolder();
		if (!picked) return;
		const name = await pickName(path.basename(picked));
		if (!name) return;
		return scaffoldInto(picked, name);
	}
}

async function scaffoldInto(projectDir: string, name: string): Promise<void> {
	if (hasCargoToml(projectDir)) {
		vscode.window.showErrorMessage(
			vscode.l10n.t('A Cargo.toml already exists in {0}.', projectDir),
		);
		return;
	}
	// The template copy below would silently overwrite existing sources.
	if (fs.existsSync(path.join(projectDir, 'src'))) {
		vscode.window.showErrorMessage(
			vscode.l10n.t(
				'A src folder already exists in {0}. Move it first or pick an empty folder.',
				projectDir,
			),
		);
		return;
	}
	// Likewise the template's .cargo/config.toml would overwrite a user's existing one.
	if (fs.existsSync(path.join(projectDir, '.cargo', 'config.toml'))) {
		vscode.window.showErrorMessage(
			vscode.l10n.t(
				'A .cargo/config.toml already exists in {0}. Move it first or pick an empty folder.',
				projectDir,
			),
		);
		return;
	}

	let rev: string;
	try {
		rev = await fetchLatestXousCoreRev();
	} catch (e: unknown) {
		toastRevFetchFailed(e);
		return;
	}

	// Whether .cargo already existed decides whether the rollback below may remove it.
	const dotCargoDir = path.join(projectDir, '.cargo');
	const dotCargoPreexisted = fs.existsSync(dotCargoDir);

	try {
		const target = getBuildTargetOrDefault();
		const templateDir = getTemplateDir(target);
		if (!hasCargoToml(templateDir)) {
			vscode.window.showErrorMessage(
				vscode.l10n.t('No out-of-tree template available for target "{0}".', target),
			);
			return;
		}

		const cargoContent = fs
			.readFileSync(path.join(templateDir, 'Cargo.toml'), 'utf8')
			.replace(/\{\{NAME\}\}/g, name)
			.replace(/\{\{REV\}\}/g, rev);

		fs.mkdirSync(dotCargoDir, { recursive: true });

		fs.writeFileSync(path.join(projectDir, 'Cargo.toml'), cargoContent, 'utf8');
		fs.cpSync(path.join(templateDir, 'src'), path.join(projectDir, 'src'), { recursive: true });
		fs.copyFileSync(
			path.join(templateDir, '.cargo', 'config.toml'),
			path.join(dotCargoDir, 'config.toml'),
		);
	} catch (e: unknown) {
		// Roll back what this run wrote so a half-created project does not block a retry (Cargo.toml
		// and src are the folder guards above, verified absent). Only remove paths this run created.
		try {
			fs.rmSync(path.join(projectDir, 'Cargo.toml'), { force: true });
			fs.rmSync(path.join(projectDir, 'src'), { recursive: true, force: true });
			// A guard above verified no config.toml pre-existed, so the one here is ours: remove it
			// (else it would trip that guard on retry). Only remove the whole .cargo if we made it.
			if (dotCargoPreexisted) fs.rmSync(path.join(dotCargoDir, 'config.toml'), { force: true });
			else fs.rmSync(dotCargoDir, { recursive: true, force: true });
		} catch {}
		const message = toMessage(e);
		errorToast(vscode.l10n.t('Failed to create project: {0}', message));
		return;
	}

	// Announce success before touching workspace folders: adding the first folder to an empty
	// window reloads the extension host, which would discard a toast shown afterward.
	vscode.window.showInformationMessage(
		vscode.l10n.t('Created out-of-tree app "{0}" at {1}.', name, projectDir),
	);

	const existingFolders = vscode.workspace.workspaceFolders ?? [];
	// realpath-/case-aware so a differently-cased pick (Windows) or a folder that already covers
	// projectDir is not re-added as a duplicate.
	const alreadyOpen = existingFolders.some((f) => isSameOrParentPath(f.uri.fsPath, projectDir));
	if (!alreadyOpen) {
		vscode.workspace.updateWorkspaceFolders(existingFolders.length, 0, {
			uri: vscode.Uri.file(projectDir),
			name,
		});
	}
}
