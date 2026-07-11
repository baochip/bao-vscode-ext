import * as assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { XOUS_CORE_REPO } from '@constants';
import * as appService from '@services/appService';
import { fetchETag, fetchJson } from '@services/httpService';
import { CI_BASE } from '@services/kernelService';
import { BETRUSTED_RUST_RELEASES } from '@services/toolkitService';
import { activateExtension, cleanupTmpDirs, tmpDir } from './helpers';

/**
 * Real-world drift tests: run the extension's tooling against the live xous-core repository
 * and the external services it depends on, to catch upstream changes (renamed directories,
 * removed crates, moved download endpoints) that fixture-based tests can never see.
 *
 * Opt-in via BAO_TEST_REAL=1 (needs network and a shallow clone of xous-core); wired into the
 * Ubuntu CI job only. An outage of one of these services fails this suite even though the
 * extension code is unchanged - that alert is deliberate.
 */
suite('Real-world drift (opt-in: BAO_TEST_REAL=1)', function () {
	this.timeout(600_000);

	let root = '';

	suiteSetup(async function () {
		if (!process.env.BAO_TEST_REAL) this.skip();
		await activateExtension();
		root = path.join(tmpDir(), 'xous-core');
		const clone = spawnSync('git', ['clone', '--depth', '1', '--quiet', XOUS_CORE_REPO, root], {
			encoding: 'utf8',
		});
		assert.equal(clone.status, 0, `git clone failed: ${clone.stderr}`);

		// Scaffold once so each test sees the same generated app regardless of run order.
		const created = await appService.createBaoApp(root, 'probe_app', 'dabao');
		assert.ok(created, 'createBaoApp succeeded on the real tree');
	});

	suiteTeardown(() => cleanupTmpDirs());

	test('the real tree still has the expected layout and checked-in dabao apps', async () => {
		assert.ok(fs.existsSync(path.join(root, 'Cargo.toml')), 'workspace root manifest');
		const apps = await appService.listBaoApps(root, 'dabao');
		assert.ok(apps.length > 0, 'apps-dabao contains at least one app');
	});

	test('createBaoApp finds every template dep in the real tree and emits valid path deps', () => {
		const cargo = fs.readFileSync(path.join(root, 'apps-dabao', 'probe_app', 'Cargo.toml'), 'utf8');
		assert.ok(!cargo.includes(`git = "${XOUS_CORE_REPO}"`), 'no xous-core git deps left');
		let pathDeps = 0;
		for (const m of cargo.matchAll(/path = "([^"]+)"/g)) {
			pathDeps++;
			const target = path.resolve(root, 'apps-dabao', 'probe_app', m[1]);
			assert.ok(fs.existsSync(path.join(target, 'Cargo.toml')), `path dep exists on disk: ${m[1]}`);
		}
		assert.ok(pathDeps > 0, 'at least one dep was rewritten to a path');
	});

	test('cargo accepts the edited root manifest and the generated app as a workspace member', function () {
		// --no-deps parses every member manifest without resolving the dependency graph, so this
		// stays fast and network-free while proving both TOML edits are valid to cargo itself.
		const r = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
			cwd: root,
			encoding: 'utf8',
			maxBuffer: 128 * 1024 * 1024,
		});
		if (r.error) this.skip(); // no cargo on this machine - the assertions need it
		assert.equal(r.status, 0, `cargo metadata failed:\n${r.stderr}`);
		const meta = JSON.parse(r.stdout) as { packages: { name: string }[] };
		assert.ok(
			meta.packages.some((p) => p.name === 'probe_app'),
			'generated app recognized as a workspace member',
		);
	});

	test('the kernel CI endpoint still serves loader and xous images with ETags', async () => {
		for (const file of ['loader.uf2', 'xous.uf2']) {
			assert.ok(await fetchETag(`${CI_BASE}/${file}`), `ETag present for ${file}`);
		}
	});

	test('the toolchain release list still parses with riscv32imac assets', async function () {
		let releases: Record<string, unknown>[];
		try {
			releases = (await fetchJson(BETRUSTED_RUST_RELEASES)) as Record<string, unknown>[];
		} catch (e) {
			// Unauthenticated GitHub API calls from shared CI runners can be rate-limited;
			// that is not upstream drift, so skip rather than fail.
			if (String(e).includes('403')) return this.skip();
			throw e;
		}
		assert.ok(Array.isArray(releases) && releases.length > 0, 'non-empty release list');
		assert.ok(
			releases.some((r) => {
				const assets = r.assets as { name?: unknown }[] | undefined;
				return (
					Array.isArray(assets) && assets.some((a) => String(a.name).startsWith('riscv32imac'))
				);
			}),
			'at least one release carries riscv32imac assets',
		);
	});
});
