import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { XOUS_TARGET_TRIPLE } from '@constants';
import { downloadFile, fetchJson } from '@services/httpService';
import { runProcess } from '@services/procService';
import { parseRustcVersion, pickHighestPatchIndex } from '@util/rust';
import * as vscode from 'vscode';

const BETRUSTED_RUST_RELEASES = 'https://api.github.com/repos/betrusted-io/rust/releases';

/** Check if the Xous target is already installed in the current rustc sysroot. */
export function isXousToolkitInstalled(): boolean {
	const r = spawnSync('rustc', ['--print', 'sysroot'], { encoding: 'utf8' });
	if (!r.stdout) return false;
	const xousDir = path.join(r.stdout.trim(), 'lib', 'rustlib', XOUS_TARGET_TRIPLE);
	return fs.existsSync(xousDir);
}

/** Derive the host rustup triple from Node's process info. */
function hostTriple(): string {
	const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
	if (process.platform === 'win32') return `${arch}-pc-windows-msvc`;
	if (process.platform === 'darwin') return `${arch}-apple-darwin`;
	return `${arch}-unknown-linux-gnu`;
}

/** Extract a zip file into dest using the platform's native tools (async - a multi-hundred-MB
 * extract must not block the extension host). */
async function extractZip(zipPath: string, dest: string): Promise<void> {
	const r =
		process.platform === 'win32'
			? // Pass paths via env vars (not string interpolation) so a crafted path can't inject PowerShell.
				await runProcess(
					'powershell',
					[
						'-NoProfile',
						'-Command',
						'Expand-Archive -LiteralPath $env:BAO_SRC -DestinationPath $env:BAO_DST -Force',
					],
					{ env: { ...process.env, BAO_SRC: zipPath, BAO_DST: dest } },
				)
			: await runProcess('unzip', ['-o', zipPath, '-d', dest]);
	if (r.error || r.code !== 0) {
		const detail = (r.error?.message || r.stderr || r.stdout || '').trim();
		throw new Error(`Failed to extract ${zipPath} to ${dest}${detail ? `: ${detail}` : ''}`);
	}
}

/** Verify the platform's archive-extraction tool is available, else throw an actionable error. */
function ensureExtractToolAvailable(): void {
	const isWin = process.platform === 'win32';
	const tool = isWin ? 'powershell' : 'unzip';
	const probe = spawnSync(tool, isWin ? ['-NoProfile', '-Command', 'exit 0'] : ['-v'], {
		stdio: 'ignore',
	});
	if (probe.error) {
		throw new Error(
			vscode.l10n.t(
				'"{0}" is required to install the Xous toolchain but was not found on your PATH. Please install it and try again.',
				tool,
			),
		);
	}
}

/**
 * Download and install the Xous toolchain target into the current rustc sysroot.
 * Hits the betrusted-io/rust GitHub releases, finds the release matching the
 * current rustc version, downloads the host-appropriate zip, and extracts it.
 */
export async function installXousToolkit(): Promise<void> {
	// Get current rustc version and sysroot
	const rustcVer = spawnSync('rustc', ['--version'], { encoding: 'utf8' });
	const rustVersion = parseRustcVersion(rustcVer.stdout ?? ''); // e.g. "1.87.0"
	if (!rustVersion) throw new Error('Could not determine rustc version');

	const sysrootResult = spawnSync('rustc', ['--print', 'sysroot'], { encoding: 'utf8' });
	const sysroot = sysrootResult.stdout?.trim() ?? '';
	if (!sysroot) throw new Error('Could not determine rustc sysroot');

	// Fail fast (before the large download) if we can't extract the archive.
	ensureExtractToolAvailable();

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Installing Xous toolchain target...'),
			cancellable: false,
		},
		async (progress) => {
			progress.report({ message: vscode.l10n.t('Fetching release list...') });
			const releases = (await fetchJson(BETRUSTED_RUST_RELEASES)) as Record<string, unknown>[];

			// Find releases whose tag starts with the current rustc version
			const matching = releases.filter((r) => {
				const tag = r.tag_name;
				return typeof tag === 'string' && tag.startsWith(rustVersion);
			});
			if (matching.length === 0) {
				throw new Error(
					`No Xous toolchain release found for rustc ${rustVersion}. ` +
						`You may need to update Rust or run 'cargo xtask install-toolkit' manually.`,
				);
			}

			// Pick the highest patch by its tag suffix - the API lists releases newest-first, so
			// positional picks are ordering-dependent (last = oldest, the pre-fix bug).
			const tags = matching.map((r) => String(r.tag_name));
			const release = matching[pickHighestPatchIndex(tags, rustVersion)];
			const assets = release.assets as Record<string, unknown>[];

			const host = hostTriple();

			// Require an asset matching the host triple - no wrong-host fallback (would install a broken toolchain).
			const isXousAsset = (a: Record<string, unknown>) => {
				const name = a.name;
				return (
					(typeof name === 'string' && name.split('_')[0] === XOUS_TARGET_TRIPLE.split('-')[0]) ||
					(typeof name === 'string' && name.startsWith('riscv32imac'))
				);
			};
			const hostAsset = assets.find((a) => {
				const name = a.name;
				return typeof name === 'string' && name.includes(host) && isXousAsset(a);
			});

			if (!hostAsset) {
				throw new Error(
					`No Xous toolchain asset found for ${host} in release ${release.tag_name}. ` +
						`Try running 'cargo xtask install-toolkit' manually.`,
				);
			}

			const downloadUrl = hostAsset.browser_download_url as string;
			const assetName = hostAsset.name as string;

			progress.report({ message: vscode.l10n.t('Downloading {0}...', assetName) });
			// Use a fixed local filename, never the remote-controlled asset name (path traversal / injection).
			const tmpZip = path.join(os.tmpdir(), 'baochip-xous-toolkit.zip');
			await downloadFile(downloadUrl, tmpZip);

			progress.report({ message: vscode.l10n.t('Extracting toolchain...') });
			// Extract to a staging dir and validate the expected target layout before touching the
			// sysroot, so a malformed/wrong archive can't corrupt the toolchain.
			const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'baochip-toolkit-'));
			try {
				await extractZip(tmpZip, stageDir);
				const stagedTarget = path.join(stageDir, 'lib', 'rustlib', XOUS_TARGET_TRIPLE);
				if (!fs.existsSync(stagedTarget)) {
					throw new Error(
						vscode.l10n.t(
							'The downloaded toolchain archive did not contain the expected {0} target. Aborting install.',
							XOUS_TARGET_TRIPLE,
						),
					);
				}
				fs.cpSync(stageDir, sysroot, { recursive: true });
			} finally {
				fs.rmSync(stageDir, { recursive: true, force: true });
				try {
					fs.unlinkSync(tmpZip);
				} catch {}
			}
		},
	);
}
