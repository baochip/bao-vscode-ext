import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { XOUS_TARGET_TRIPLE } from '@constants';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

export const EXT_ID = 'baochip.bao-vscode-ext';

/** A fake OutputChannel capturing appendLine text, castable to vscode.OutputChannel. */
export function fakeChannel(): { lines: string[]; chan: vscode.OutputChannel } {
	const lines: string[] = [];
	const chan = {
		lines,
		appendLine: (l: string) => lines.push(l),
		append: () => {},
		clear: () => {},
		show: () => {},
	};
	return { lines, chan: chan as unknown as vscode.OutputChannel };
}

/** Get the extension, asserting it is present, and ensure it is activated. */
export async function activateExtension(): Promise<vscode.Extension<unknown>> {
	const ext = vscode.extensions.getExtension(EXT_ID);
	if (!ext) throw new Error(`extension not found: ${EXT_ID}`);
	if (!ext.isActive) await ext.activate();
	return ext;
}

/**
 * Create a per-suite sinon sandbox that is restored automatically after each test.
 * Call at suite scope: `const sandbox = useSandbox();`
 */
export function useSandbox(): sinon.SinonSandbox {
	const sandbox = sinon.createSandbox();
	teardown(() => sandbox.restore());
	return sandbox;
}

/** All contributed baochip.* setting keys, read from the extension manifest (no list to drift). */
function contributedSettingKeys(): string[] {
	const ext = vscode.extensions.getExtension(EXT_ID);
	if (!ext) throw new Error(`extension not found: ${EXT_ID}`);
	const manifest = ext.packageJSON as {
		contributes: { configuration: { properties?: Record<string, unknown> }[] };
	};
	return manifest.contributes.configuration.flatMap((s) => Object.keys(s.properties ?? {}));
}

/**
 * Clear every contributed baochip.* setting at the target it is written to
 * (Global for the application-scoped welcome toggle, Workspace for the rest),
 * so tests start from defaults and leave nothing behind in the fixture workspace.
 */
export async function resetBaochipConfig(): Promise<void> {
	const cfg = vscode.workspace.getConfiguration();
	for (const key of contributedSettingKeys()) {
		const target =
			key === 'baochip.showWelcomeOnStartup'
				? vscode.ConfigurationTarget.Global
				: vscode.ConfigurationTarget.Workspace;
		await cfg.update(key, undefined, target);
	}
}

export interface FakeXousCoreOptions {
	/** Build target; determines the apps-<target> directory name. Default 'dabao'. */
	target?: string;
	/** App directories to create (each gets a Cargo.toml). Default ['hello']. */
	apps?: string[];
	/** Also create target/<triple>/release/{loader,xous,apps}.uf2 dummy artifacts. */
	withArtifacts?: boolean;
}

export interface FakeXousCore {
	root: string;
	appsDir: string;
	releaseDir?: string;
}

/**
 * Build a minimal fake xous-core tree under `root`: apps-<target>/<app>/Cargo.toml per app,
 * a root workspace Cargo.toml listing them as members, and (optionally) dummy UF2 artifacts.
 */
export function makeFakeXousCore(root: string, opts: FakeXousCoreOptions = {}): FakeXousCore {
	const target = opts.target ?? 'dabao';
	const apps = opts.apps ?? ['hello'];
	const appsDirName = `apps-${target}`;
	const appsDir = path.join(root, appsDirName);

	for (const app of apps) {
		const dir = path.join(appsDir, app);
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, 'Cargo.toml'),
			`[package]\nname = "${app}"\nversion = "0.1.0"\nedition = "2021"\n`,
			'utf8',
		);
	}

	const members = apps.map((a) => `  "${appsDirName}/${a}",`).join('\n');
	fs.writeFileSync(
		path.join(root, 'Cargo.toml'),
		`[workspace]\nmembers = [\n${members}\n]\n`,
		'utf8',
	);

	let releaseDir: string | undefined;
	if (opts.withArtifacts) {
		releaseDir = path.join(root, 'target', XOUS_TARGET_TRIPLE, 'release');
		fs.mkdirSync(releaseDir, { recursive: true });
		for (const name of ['loader.uf2', 'xous.uf2', 'apps.uf2']) {
			fs.writeFileSync(path.join(releaseDir, name), `fake ${name} contents\n`, 'utf8');
		}
	}

	return { root, appsDir, releaseDir };
}

const createdTmpDirs: string[] = [];

/**
 * Create a unique temp directory. Cleanup is deferred: suites that use tmpDir()
 * must register `teardown(cleanupTmpDirs)` (or call it in suiteTeardown).
 */
export function tmpDir(prefix = 'bao-test-'): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	createdTmpDirs.push(dir);
	return dir;
}

/** Remove every directory created by tmpDir() so far. Safe to call repeatedly. */
export function cleanupTmpDirs(): void {
	for (const dir of createdTmpDirs.splice(0)) {
		try {
			fs.rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
}
