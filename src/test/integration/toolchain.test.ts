import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { XOUS_TARGET_TRIPLE } from '@constants';
import * as procService from '@services/procService';
import { checkRustToolchain } from '@services/rustCheckService';
import { isXousToolkitInstalled } from '@services/toolkitService';
import type * as sinon from 'sinon';
import * as vscode from 'vscode';
import { activateExtension, cleanupTmpDirs, tmpDir, useSandbox } from './helpers';

/** A successful, empty runProcess result. */
const okRun: procService.RunResult = { code: 0, stdout: '', stderr: '', cancelled: false };

/** A tmp sysroot directory that does (or does not) contain the installed Xous target layout. */
function fakeSysroot(withXousTarget: boolean): string {
	const root = tmpDir('bao-sysroot-');
	if (withXousTarget) {
		fs.mkdirSync(path.join(root, 'lib', 'rustlib', XOUS_TARGET_TRIPLE), { recursive: true });
	}
	return root;
}

suite('Rust toolchain checks', () => {
	const sandbox = useSandbox();

	suiteSetup(async () => {
		await activateExtension();
	});

	teardown(() => {
		cleanupTmpDirs();
	});

	/**
	 * Stub runProcess with a per-command handler so no real rustc/cargo/rustup is spawned. Any
	 * command the handler does not recognize resolves to a successful empty run.
	 */
	function stubRunProcess(
		handler: (cmd: string, args: string[]) => Partial<procService.RunResult>,
	): sinon.SinonStub {
		return sandbox
			.stub(procService, 'runProcess')
			.callsFake(async (cmd: string, args: string[] = []) => ({
				...okRun,
				...handler(cmd, args),
			}));
	}

	/** Default happy-path responder: tools present, both targets installed. */
	function allPresent(sysroot: string) {
		return (cmd: string, args: string[]): Partial<procService.RunResult> => {
			if (cmd === 'rustc' && args.includes('--print')) return { stdout: sysroot };
			if (cmd === 'rustc') return { stdout: 'rustc 1.87.0' };
			if (cmd === 'cargo') return { stdout: 'cargo 1.87.0' };
			if (cmd === 'rustup')
				return { stdout: 'riscv32imac-unknown-none-elf\nwasm32-unknown-unknown' };
			return {};
		};
	}

	/* ------------------------------ checkRustToolchain ------------------------------ */

	test('checkRustToolchain returns true when the tools and both targets are present', async () => {
		stubRunProcess(allPresent(fakeSysroot(true)));
		const warn = sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub;
		const err = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const ok = await checkRustToolchain();

		assert.equal(ok, true);
		assert.ok(warn.notCalled, 'no install prompt when both targets are present');
		assert.ok(err.notCalled, 'no error toast');
	});

	test('checkRustToolchain returns false with a Rust-not-found error when rustc is missing', async () => {
		stubRunProcess((cmd) =>
			cmd === 'rustc' ? { code: null, error: new Error('spawn rustc ENOENT') } : {},
		);
		const err = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const ok = await checkRustToolchain();

		assert.equal(ok, false);
		assert.ok(
			err.getCalls().some((c) => String(c.args[0]).includes('Rust not found')),
			'Rust-not-found error shown',
		);
	});

	test('checkRustToolchain returns false with a Cargo-not-found error when cargo is missing', async () => {
		stubRunProcess((cmd) => {
			if (cmd === 'rustc') return { stdout: 'rustc 1.87.0' };
			if (cmd === 'cargo') return { code: null, error: new Error('spawn cargo ENOENT') };
			return {};
		});
		const err = sandbox.stub(vscode.window, 'showErrorMessage') as unknown as sinon.SinonStub;

		const ok = await checkRustToolchain();

		assert.equal(ok, false);
		assert.ok(
			err.getCalls().some((c) => String(c.args[0]).includes('Cargo not found')),
			'Cargo-not-found error shown',
		);
	});

	test('checkRustToolchain prompts to install a missing rustup target and continues when dismissed', async () => {
		// none-elf target absent from the rustup list; the xous toolkit is present so only one prompt.
		stubRunProcess((cmd, args) => {
			if (cmd === 'rustc' && args.includes('--print')) return { stdout: fakeSysroot(true) };
			if (cmd === 'rustc') return { stdout: 'rustc 1.87.0' };
			if (cmd === 'cargo') return { stdout: 'cargo 1.87.0' };
			if (cmd === 'rustup') return { stdout: 'wasm32-unknown-unknown' };
			return {};
		});
		const warn = (
			sandbox.stub(vscode.window, 'showWarningMessage') as unknown as sinon.SinonStub
		).resolves('Ignore');

		const ok = await checkRustToolchain();

		assert.equal(ok, true, 'a dismissed non-fatal target prompt still lets the build proceed');
		assert.ok(
			warn.getCalls().some((c) => String(c.args[0]).includes('riscv32imac-unknown-none-elf')),
			'install prompt named the missing target',
		);
	});

	/* ------------------------------ isXousToolkitInstalled ------------------------------ */

	test('isXousToolkitInstalled is true when the sysroot holds the xous target', async () => {
		const sysroot = fakeSysroot(true);
		stubRunProcess((cmd, args) =>
			cmd === 'rustc' && args.includes('--print') ? { stdout: `${sysroot}\n` } : {},
		);

		assert.equal(await isXousToolkitInstalled(), true);
	});

	test('isXousToolkitInstalled is false when the target dir is absent', async () => {
		const sysroot = fakeSysroot(false);
		stubRunProcess((cmd, args) =>
			cmd === 'rustc' && args.includes('--print') ? { stdout: `${sysroot}\n` } : {},
		);

		assert.equal(await isXousToolkitInstalled(), false);
	});

	test('isXousToolkitInstalled is false when rustc cannot be spawned', async () => {
		stubRunProcess(() => ({ code: null, error: new Error('spawn rustc ENOENT') }));

		assert.equal(await isXousToolkitInstalled(), false);
	});
});
