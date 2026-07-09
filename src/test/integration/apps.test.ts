import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { XOUS_CORE_REPO } from '@constants';
import * as appService from '@services/appService';
import * as kernelService from '@services/kernelService';
import * as outOfTreeScaffoldService from '@services/outOfTreeScaffoldService';
import * as uvService from '@services/uvService';
import * as workspaceService from '@services/workspaceService';
import * as xousCoreService from '@services/xousCoreService';
import { parseWorkspaceMembers } from '@util/cargo';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import {
	activateExtension,
	cleanupTmpDirs,
	makeFakeXousCore,
	resetBaochipConfig,
	tmpDir,
	useSandbox,
} from './helpers';

const cfg = () => vscode.workspace.getConfiguration('baochip');
const setCfg = (key: string, value: unknown) =>
	cfg().update(key, value, vscode.ConfigurationTarget.Workspace);

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

suite('App service and scaffolding', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	teardown(async () => {
		await resetBaochipConfig();
		cleanupTmpDirs();
	});

	/* ------------------------------ listBaoApps / missingApps ------------------------------ */

	test('listBaoApps lists only directories with a Cargo.toml, sorted', async () => {
		const { root, appsDir } = makeFakeXousCore(tmpDir(), { apps: ['zeta', 'alpha'] });
		fs.mkdirSync(path.join(appsDir, 'nocargo')); // dir without a Cargo.toml
		fs.writeFileSync(path.join(appsDir, 'loose-file.txt'), 'not an app', 'utf8');

		assert.deepEqual(await appService.listBaoApps(root, 'dabao'), ['alpha', 'zeta']);
	});

	test('listBaoApps is empty when the apps directory does not exist', async () => {
		assert.deepEqual(await appService.listBaoApps(tmpDir(), 'dabao'), []);
	});

	test('missingApps/appExists handle multi-app strings and extra whitespace', async () => {
		const { root } = makeFakeXousCore(tmpDir(), { apps: ['hello', 'world'] });

		assert.deepEqual(appService.missingApps(root, 'hello ghost world phantom', 'dabao'), [
			'ghost',
			'phantom',
		]);
		assert.equal(appService.appExists(root, ' hello  world ', 'dabao'), true);
		assert.equal(appService.appExists(root, 'hello ghost', 'dabao'), false);
	});

	/* ------------------------------ promptAndSaveApp ------------------------------ */

	test('promptAndSaveApp returns undefined immediately in out-of-tree mode', async () => {
		await setCfg('buildMode', 'out-of-tree');
		const pick = sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub;

		const result = await appService.promptAndSaveApp();

		assert.equal(result, undefined);
		assert.ok(pick.notCalled, 'no picker in out-of-tree mode');
	});

	test('promptAndSaveApp warns when no apps exist', async () => {
		const { root } = makeFakeXousCore(tmpDir(), { apps: [] });
		await setCfg('buildMode', 'xous-core');
		sandbox.stub(xousCoreService, 'resolveXousRootOrNotify').resolves(root);
		sandbox.stub(workspaceService, 'ensureXousWorkspaceOpen').resolves(root);
		const warnings = sandbox.stub(
			vscode.window,
			'showWarningMessage',
		) as unknown as sinon.SinonStub;

		const result = await appService.promptAndSaveApp();

		assert.equal(result, undefined);
		assert.ok(
			warnings.getCalls().some((c) => String(c.args[0]).includes('No apps found')),
			'create-one-first warning shown',
		);
	});

	test('promptAndSaveApp saves the pick and marks the current app', async () => {
		const { root } = makeFakeXousCore(tmpDir(), { apps: ['zeta', 'alpha'] });
		await setCfg('buildMode', 'xous-core');
		await setCfg('xousAppName', 'zeta');
		sandbox.stub(xousCoreService, 'resolveXousRootOrNotify').resolves(root);
		sandbox.stub(workspaceService, 'ensureXousWorkspaceOpen').resolves(root);
		sandbox.stub(vscode.window, 'showInformationMessage');
		const pick = sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub;
		pick.resolves({ label: 'alpha' });

		const result = await appService.promptAndSaveApp();

		assert.equal(result, 'alpha');
		assert.equal(cfg().get<string>('xousAppName'), 'alpha');
		const items = pick.firstCall.args[0] as { label: string; description?: string }[];
		assert.deepEqual(
			items.map((i) => i.label),
			['alpha', 'zeta'],
		);
		assert.equal(items[1].description, 'current', 'configured app marked current');
	});

	test('promptAndSaveApp lists apps from the adopted workspace root, not the configured one', async () => {
		// The user adopts the currently-open folder; app listing must follow the returned root.
		const { root: configuredRoot } = makeFakeXousCore(tmpDir(), { apps: ['configured_app'] });
		const { root: adoptedRoot } = makeFakeXousCore(tmpDir(), { apps: ['adopted_app'] });
		await setCfg('buildMode', 'xous-core');
		sandbox.stub(xousCoreService, 'resolveXousRootOrNotify').resolves(configuredRoot);
		sandbox.stub(workspaceService, 'ensureXousWorkspaceOpen').resolves(adoptedRoot);
		sandbox.stub(vscode.window, 'showInformationMessage');
		const pick = sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub;
		pick.resolves(undefined);

		await appService.promptAndSaveApp();

		const items = pick.firstCall.args[0] as { label: string }[];
		assert.deepEqual(
			items.map((i) => i.label),
			['adopted_app'],
			'apps come from the adopted root, not the configured checkout',
		);
	});

	/* ------------------------------ createBaoApp (real bundled template) ------------------------------ */

	/** Every xous-core crate the dabao template depends on via git. */
	const TEMPLATE_XOUS_CRATES = [
		'bao1x-hal',
		'bao1x-api',
		'bao1x-hal-service',
		'bao1x-emu',
		'usb-bao1x',
		'aes',
		'bio-lib',
	];

	/** A fake xous-core whose workspace carries the given crates as libs/<name> members. */
	function makeXousCoreWithLibs(crates: string[]): string {
		const { root } = makeFakeXousCore(tmpDir(), { apps: ['hello'] });
		for (const crate of crates) {
			const libDir = path.join(root, 'libs', crate);
			fs.mkdirSync(libDir, { recursive: true });
			fs.writeFileSync(
				path.join(libDir, 'Cargo.toml'),
				`[package]\nname = "${crate}"\nversion = "0.1.0"\n`,
				'utf8',
			);
		}
		const members = ['apps-dabao/hello', ...crates.map((c) => `libs/${c}`)]
			.map((m) => `  "${m}",`)
			.join('\n');
		fs.writeFileSync(
			path.join(root, 'Cargo.toml'),
			`[workspace]\nmembers = [\n${members}\n]\n`,
			'utf8',
		);
		return root;
	}

	test('createBaoApp scaffolds from the bundled template with local path deps and no patch section', async () => {
		const root = makeXousCoreWithLibs(TEMPLATE_XOUS_CRATES);

		await appService.createBaoApp(root, 'my_app', 'dabao');

		const appDir = path.join(root, 'apps-dabao', 'my_app');
		const cargo = fs.readFileSync(path.join(appDir, 'Cargo.toml'), 'utf8');
		assert.ok(cargo.includes('name = "my_app"'), 'package name substituted');
		assert.ok(!cargo.includes('{{NAME}}') && !cargo.includes('{{REV}}'), 'no placeholders left');
		assert.ok(!cargo.includes('[patch.crates-io]'), 'crates-io patch section removed');
		assert.ok(!cargo.includes('[patch'), 'no patch section of any kind');
		assert.ok(!cargo.includes(`git = "${XOUS_CORE_REPO}"`), 'no xous-core git deps left');
		for (const crate of TEMPLATE_XOUS_CRATES) {
			assert.ok(
				cargo.includes(`path = "../../libs/${crate}"`),
				`${crate} rewritten to a local path dep:\n${cargo}`,
			);
		}
		assert.ok(cargo.includes('xous-usb-hid = { git ='), 'deps on other git repos stay git deps');
		assert.ok(fs.existsSync(path.join(appDir, 'src', 'main.rs')), 'template src copied');
		assert.ok(fs.existsSync(path.join(appDir, '.cargo', 'config.toml')), 'cargo config copied');
		const members = parseWorkspaceMembers(fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8'));
		assert.ok(members.includes('apps-dabao/my_app'), `new app registered: ${members.join(', ')}`);
	});

	test('createBaoApp returns true and registers the app on the happy path', async () => {
		const root = makeXousCoreWithLibs(TEMPLATE_XOUS_CRATES);

		const registered = await appService.createBaoApp(root, 'reg_app', 'dabao');

		assert.equal(registered, true, 'app registered in the workspace members');
	});

	test('createBaoApp cleans up the app directory when a copy step fails', async () => {
		// A fake extension root whose bundled template has a Cargo.toml but NO src/ directory:
		// the src copy then fails naturally after the app dir was already created (the node fs
		// module is frozen in this host, so the failure cannot be injected with a stub).
		const fakeExtRoot = tmpDir();
		const templateDir = path.join(fakeExtRoot, 'resources', 'templates', 'out-of-tree', 'dabao');
		fs.mkdirSync(templateDir, { recursive: true });
		fs.writeFileSync(
			path.join(templateDir, 'Cargo.toml'),
			'[package]\nname = "{{NAME}}"\n\n[dependencies]\n' +
				'bao1x-api = { git = "https://github.com/betrusted-io/xous-core", rev = "{{REV}}" }\n',
			'utf8',
		);
		sandbox.stub(uvService, 'getExtensionRoot').returns(fakeExtRoot);
		const root = makeXousCoreWithLibs(['bao1x-api']);

		await assert.rejects(appService.createBaoApp(root, 'my_app', 'dabao'));
		assert.ok(
			!fs.existsSync(path.join(root, 'apps-dabao', 'my_app')),
			'partial app directory removed so a retry is not blocked',
		);
	});

	test('createBaoApp returns false when the members array cannot be edited', async () => {
		const root = makeXousCoreWithLibs(TEMPLATE_XOUS_CRATES);
		// single-line members array: parseable for the package map, but the member-append
		// edit (which needs the multi-line form) cannot apply
		const members = ['apps-dabao/hello', ...TEMPLATE_XOUS_CRATES.map((c) => `libs/${c}`)]
			.map((m) => `"${m}"`)
			.join(', ');
		fs.writeFileSync(
			path.join(root, 'Cargo.toml'),
			`[workspace]\nmembers = [${members}]\n`,
			'utf8',
		);

		const registered = await appService.createBaoApp(root, 'my_app', 'dabao');

		assert.equal(registered, false, 'caller can surface the single manual-add message');
		assert.ok(fs.existsSync(path.join(root, 'apps-dabao', 'my_app')), 'app itself was created');
	});

	test('createBaoApp keeps the app and returns false when the root Cargo.toml write fails', async () => {
		const root = makeXousCoreWithLibs(TEMPLATE_XOUS_CRATES);
		const rootCargo = path.join(root, 'Cargo.toml');
		// Make the root manifest read-only so the members-array write fails after the app is created.
		fs.chmodSync(rootCargo, 0o444);
		// Skip on a host where the read-only bit does not block writes (e.g. running as root in CI).
		let readOnlyBlocksWrites = true;
		try {
			fs.writeFileSync(rootCargo, fs.readFileSync(rootCargo, 'utf8'));
			readOnlyBlocksWrites = false;
		} catch {}
		if (!readOnlyBlocksWrites) {
			fs.chmodSync(rootCargo, 0o644);
			return;
		}

		const registered = await appService.createBaoApp(root, 'my_app', 'dabao');
		fs.chmodSync(rootCargo, 0o644); // restore before assertions so teardown can clean up

		assert.equal(
			registered,
			false,
			'a failed registration is non-fatal, reported as not-registered',
		);
		assert.ok(
			fs.existsSync(path.join(root, 'apps-dabao', 'my_app')),
			'the created app is kept (usable, just not auto-registered), not orphaned + rolled back',
		);
	});

	test('createBaoApp does not duplicate the members entry when recreating a deleted app', async () => {
		const root = makeXousCoreWithLibs(TEMPLATE_XOUS_CRATES);

		assert.equal(await appService.createBaoApp(root, 'dup_app', 'dabao'), true, 'first create');
		// The user deletes just the app folder, leaving its members entry behind.
		fs.rmSync(path.join(root, 'apps-dabao', 'dup_app'), { recursive: true, force: true });

		assert.equal(await appService.createBaoApp(root, 'dup_app', 'dabao'), true, 'recreated');

		const members = parseWorkspaceMembers(fs.readFileSync(path.join(root, 'Cargo.toml'), 'utf8'));
		assert.equal(
			members.filter((m) => m === 'apps-dabao/dup_app').length,
			1,
			'the members array lists the app exactly once, not duplicated',
		);
	});

	test('createBaoApp rejects a stale checkout missing template crates, creating nothing', async () => {
		const root = makeXousCoreWithLibs(['bao1x-api']); // most template crates absent

		await assert.rejects(appService.createBaoApp(root, 'my_app', 'dabao'), /Could not find/);
		assert.ok(
			!fs.existsSync(path.join(root, 'apps-dabao', 'my_app')),
			'no half-created app directory',
		);
	});

	test('createBaoApp rejects an app directory that already exists', async () => {
		const { root } = makeFakeXousCore(tmpDir(), { apps: ['taken'] });

		await assert.rejects(appService.createBaoApp(root, 'taken', 'dabao'), /already exists/);
	});

	test('createBaoApp rejects a target with no bundled template', async () => {
		const { root } = makeFakeXousCore(tmpDir(), { target: 'baosec', apps: ['hello'] });

		await assert.rejects(
			appService.createBaoApp(root, 'my_app', 'baosec'),
			/No out-of-tree template/,
		);
	});

	test('createBaoApp rejects a target not in BUILD_TARGETS before touching the template path', async () => {
		const { root } = makeFakeXousCore(tmpDir(), { apps: ['hello'] });

		// A traversal-shaped target must be refused up front (never joined into the template path).
		await assert.rejects(
			appService.createBaoApp(root, 'my_app', '../../../../etc'),
			/Invalid build target/,
		);
	});

	/* ------------------------------ scaffoldOutOfTreeApp ------------------------------ */

	function stubScaffoldPrompts(projectDir: string, name: string) {
		(sandbox.stub(vscode.window, 'showQuickPick') as unknown as sinon.SinonStub).resolves(
			'Choose a different folder...',
		);
		(sandbox.stub(vscode.window, 'showOpenDialog') as unknown as sinon.SinonStub).resolves([
			vscode.Uri.file(projectDir),
		]);
		sandbox.stub(vscode.window, 'showInputBox').resolves(name);
		// Stub the two folder-registration APIs so the test can assert which one the scaffold calls.
		const updateFolders = sandbox.stub(vscode.workspace, 'updateWorkspaceFolders').returns(true);
		const executeCommand = sandbox
			.stub(vscode.commands, 'executeCommand')
			.resolves(undefined) as unknown as sinon.SinonStub;
		return { updateFolders, executeCommand };
	}

	test('scaffoldOutOfTreeApp creates the project with the fetched rev pinned', async () => {
		const projectDir = tmpDir();
		const { updateFolders, executeCommand } = stubScaffoldPrompts(projectDir, 'my_oot_app');
		sandbox.stub(kernelService, 'fetchLatestXousCoreRev').resolves(SHA);
		sandbox.stub(vscode.window, 'showInformationMessage');

		await outOfTreeScaffoldService.scaffoldOutOfTreeApp();

		const cargo = fs.readFileSync(path.join(projectDir, 'Cargo.toml'), 'utf8');
		assert.ok(cargo.includes('name = "my_oot_app"'), 'package name substituted');
		assert.ok(cargo.includes(`rev = "${SHA}"`), 'fetched rev pinned');
		assert.ok(!cargo.includes('{{NAME}}') && !cargo.includes('{{REV}}'), 'no placeholders left');
		assert.ok(fs.existsSync(path.join(projectDir, 'src', 'main.rs')), 'template src copied');
		assert.ok(fs.existsSync(path.join(projectDir, '.cargo', 'config.toml')), 'cargo config copied');
		// A folder is already open (the fixture workspace), so the new project opens as its own window.
		assert.ok(updateFolders.notCalled, 'not appended after the already-open folder');
		const openCall = executeCommand.getCalls().find((c) => c.args[0] === 'vscode.openFolder');
		assert.ok(openCall, 'the new project is opened as a workspace');
		assert.equal(
			(openCall.args[1] as vscode.Uri).fsPath.toLowerCase(),
			projectDir.toLowerCase(),
			'opened at the scaffolded project dir',
		);
		assert.deepEqual(openCall.args[2], { forceNewWindow: true }, 'opened in a new window');
	});

	test('scaffoldOutOfTreeApp adopts the project as the workspace root when no folder is open', async () => {
		const projectDir = tmpDir();
		const { updateFolders, executeCommand } = stubScaffoldPrompts(projectDir, 'my_oot_app');
		sandbox.stub(vscode.workspace, 'workspaceFolders').get(() => []);
		sandbox.stub(kernelService, 'fetchLatestXousCoreRev').resolves(SHA);
		sandbox.stub(vscode.window, 'showInformationMessage');

		await outOfTreeScaffoldService.scaffoldOutOfTreeApp();

		assert.ok(fs.existsSync(path.join(projectDir, 'Cargo.toml')), 'project scaffolded');
		assert.ok(updateFolders.calledOnce, 'project adopted as the workspace root');
		assert.equal(updateFolders.firstCall.args[0], 0, 'inserted at index 0');
		const folderArg = updateFolders.firstCall.args[2] as { uri: vscode.Uri };
		assert.equal(folderArg.uri.fsPath.toLowerCase(), projectDir.toLowerCase());
		assert.ok(
			executeCommand.getCalls().every((c) => c.args[0] !== 'vscode.openFolder'),
			'no new window opened for an empty workspace',
		);
	});

	test('scaffoldOutOfTreeApp does not re-add a project already covered by an open workspace folder', async () => {
		const parent = tmpDir();
		const projectDir = path.join(parent, 'nested-app');
		fs.mkdirSync(projectDir);
		sandbox
			.stub(vscode.workspace, 'workspaceFolders')
			.get(() => [
				{ uri: vscode.Uri.file(parent), name: 'parent', index: 0 } as vscode.WorkspaceFolder,
			]);
		const { updateFolders, executeCommand } = stubScaffoldPrompts(projectDir, 'nested_app');
		sandbox.stub(kernelService, 'fetchLatestXousCoreRev').resolves(SHA);
		sandbox.stub(vscode.window, 'showInformationMessage');

		await outOfTreeScaffoldService.scaffoldOutOfTreeApp();

		assert.ok(fs.existsSync(path.join(projectDir, 'Cargo.toml')), 'project still scaffolded');
		assert.ok(updateFolders.notCalled, 'not re-added: projectDir is covered by an open folder');
		assert.ok(
			executeCommand.getCalls().every((c) => c.args[0] !== 'vscode.openFolder'),
			'no new window: projectDir is covered by an open folder',
		);
	});

	test('scaffoldOutOfTreeApp refuses a folder that already has a src directory', async () => {
		const projectDir = tmpDir();
		fs.mkdirSync(path.join(projectDir, 'src'));
		fs.writeFileSync(path.join(projectDir, 'src', 'main.rs'), 'fn main() {} // precious', 'utf8');
		stubScaffoldPrompts(projectDir, 'my_oot_app');
		sandbox.stub(kernelService, 'fetchLatestXousCoreRev').resolves(SHA);
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		await outOfTreeScaffoldService.scaffoldOutOfTreeApp();

		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('src folder already exists')),
			'src-overwrite refusal shown',
		);
		assert.equal(
			fs.readFileSync(path.join(projectDir, 'src', 'main.rs'), 'utf8'),
			'fn main() {} // precious',
			'existing sources untouched',
		);
		assert.ok(!fs.existsSync(path.join(projectDir, 'Cargo.toml')), 'nothing scaffolded');
	});

	test('scaffoldOutOfTreeApp refuses a folder that already has a Cargo.toml', async () => {
		const projectDir = tmpDir();
		fs.writeFileSync(path.join(projectDir, 'Cargo.toml'), '[package]\nname = "existing"\n', 'utf8');
		const { updateFolders } = stubScaffoldPrompts(projectDir, 'my_oot_app');
		const fetchRev = sandbox.stub(kernelService, 'fetchLatestXousCoreRev').resolves(SHA);
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		await outOfTreeScaffoldService.scaffoldOutOfTreeApp();

		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('already exists')),
			'existing-project error shown',
		);
		assert.ok(fetchRev.notCalled, 'no rev fetch for a refused folder');
		assert.ok(!fs.existsSync(path.join(projectDir, 'src')), 'nothing scaffolded');
		assert.ok(updateFolders.notCalled, 'workspace untouched');
	});

	test('scaffoldOutOfTreeApp refuses a folder that already has a .cargo/config.toml', async () => {
		const projectDir = tmpDir();
		fs.mkdirSync(path.join(projectDir, '.cargo'));
		const precious = '[build]\ntarget-dir = "precious"\n';
		fs.writeFileSync(path.join(projectDir, '.cargo', 'config.toml'), precious, 'utf8');
		const { updateFolders } = stubScaffoldPrompts(projectDir, 'my_oot_app');
		const fetchRev = sandbox.stub(kernelService, 'fetchLatestXousCoreRev').resolves(SHA);
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		await outOfTreeScaffoldService.scaffoldOutOfTreeApp();

		assert.ok(
			errors
				.getCalls()
				.some((c) => String(c.args[0]).includes('.cargo/config.toml already exists')),
			'config-overwrite refusal shown',
		);
		assert.equal(
			fs.readFileSync(path.join(projectDir, '.cargo', 'config.toml'), 'utf8'),
			precious,
			'existing .cargo/config.toml untouched',
		);
		assert.ok(fetchRev.notCalled, 'no rev fetch for a refused folder');
		assert.ok(!fs.existsSync(path.join(projectDir, 'Cargo.toml')), 'nothing scaffolded');
		assert.ok(updateFolders.notCalled, 'workspace untouched');
	});

	test('scaffoldOutOfTreeApp writes nothing when the rev fetch fails', async () => {
		const projectDir = tmpDir();
		const { updateFolders } = stubScaffoldPrompts(projectDir, 'my_oot_app');
		sandbox.stub(kernelService, 'fetchLatestXousCoreRev').rejects(new Error('offline'));
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		await outOfTreeScaffoldService.scaffoldOutOfTreeApp();

		assert.ok(
			errors
				.getCalls()
				.some((c) => String(c.args[0]).includes('Failed to fetch latest xous-core rev')),
			'fetch-failure error shown',
		);
		assert.ok(!fs.existsSync(path.join(projectDir, 'Cargo.toml')), 'nothing written');
		assert.ok(updateFolders.notCalled, 'workspace untouched');
	});

	test('scaffoldOutOfTreeApp rolls back Cargo.toml and src when a copy step fails', async () => {
		const projectDir = tmpDir();
		// A pre-existing empty .cargo (no config.toml, so the guard passes) proves rollback preserves
		// the user's dir. A fake template with Cargo.toml + src but NO .cargo/config.toml makes the
		// final config copy fail naturally, after Cargo.toml and src are written (fs is frozen in this
		// host, so the failure cannot be injected with a stub).
		fs.mkdirSync(path.join(projectDir, '.cargo'));
		const fakeExtRoot = tmpDir();
		const templateDir = path.join(fakeExtRoot, 'resources', 'templates', 'out-of-tree', 'dabao');
		fs.mkdirSync(path.join(templateDir, 'src'), { recursive: true });
		fs.writeFileSync(
			path.join(templateDir, 'Cargo.toml'),
			'[package]\nname = "{{NAME}}"\n',
			'utf8',
		);
		fs.writeFileSync(path.join(templateDir, 'src', 'main.rs'), 'fn main() {}\n', 'utf8');
		sandbox.stub(uvService, 'getExtensionRoot').returns(fakeExtRoot);
		stubScaffoldPrompts(projectDir, 'my_oot_app');
		sandbox.stub(kernelService, 'fetchLatestXousCoreRev').resolves(SHA);
		const errors = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		await outOfTreeScaffoldService.scaffoldOutOfTreeApp();

		assert.ok(
			errors.getCalls().some((c) => String(c.args[0]).includes('Failed to create project')),
			'create-failure error shown',
		);
		// The retry-blocking guards must be cleared so scaffolding can be retried.
		assert.ok(!fs.existsSync(path.join(projectDir, 'Cargo.toml')), 'Cargo.toml rolled back');
		assert.ok(!fs.existsSync(path.join(projectDir, 'src')), 'src rolled back');
		// The .cargo folder existed before this run, so rollback must leave it in place...
		assert.ok(fs.existsSync(path.join(projectDir, '.cargo')), 'pre-existing .cargo preserved');
		// ...but must not leave a config.toml behind that would trip the guard on retry.
		assert.ok(
			!fs.existsSync(path.join(projectDir, '.cargo', 'config.toml')),
			'no leftover config.toml to block a retry',
		);
	});
});
