import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { XOUS_TARGET_TRIPLE } from '@constants';
import { downloadFile, fetchJson } from '@services/httpService';
import { parseRustcVersion } from '@util/rust';
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

/** Extract a zip file into dest using the platform's native tools. */
function extractZip(zipPath: string, dest: string): Promise<void> {
	return new Promise((resolve, reject) => {
		let r: ReturnType<typeof spawnSync>;
		if (process.platform === 'win32') {
			r = spawnSync(
				'powershell',
				[
					'-NoProfile',
					'-Command',
					`Expand-Archive -Path "${zipPath}" -DestinationPath "${dest}" -Force`,
				],
				{ stdio: 'inherit' },
			);
		} else {
			r = spawnSync('unzip', ['-o', zipPath, '-d', dest], { stdio: 'inherit' });
		}
		if (r.status !== 0) {
			reject(new Error(`Failed to extract ${zipPath} to ${dest}`));
		} else {
			resolve();
		}
	});
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

	await vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: vscode.l10n.t('Baochip: Installing Xous toolchain target…'),
			cancellable: false,
		},
		async (progress) => {
			progress.report({ message: vscode.l10n.t('Fetching release list…') });
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

			// Use the last matching release (highest patch)
			const release = matching[matching.length - 1];
			const assets = release.assets as Record<string, unknown>[];

			const host = hostTriple();

			// Prefer an asset matching the host triple; fall back to any xous-elf asset
			const isXousAsset = (a: Record<string, unknown>) => {
				const name = a.name;
				return (
					(typeof name === 'string' && name.split('_')[0] === XOUS_TARGET_TRIPLE.split('-')[0]) ||
					(typeof name === 'string' && name.startsWith('riscv32imac'))
				);
			};
			const hostAsset =
				assets.find((a) => {
					const name = a.name;
					return typeof name === 'string' && name.includes(host) && isXousAsset(a);
				}) ?? assets.find(isXousAsset);

			if (!hostAsset) {
				throw new Error(
					`No Xous toolchain asset found for ${host} in release ${release.tag_name}. ` +
						`Try running 'cargo xtask install-toolkit' manually.`,
				);
			}

			const downloadUrl = hostAsset.browser_download_url as string;
			const assetName = hostAsset.name as string;

			progress.report({ message: vscode.l10n.t('Downloading {0}…', assetName) });
			const tmpZip = path.join(os.tmpdir(), assetName);
			await downloadFile(downloadUrl, tmpZip);

			progress.report({ message: vscode.l10n.t('Extracting toolchain…') });
			await extractZip(tmpZip, sysroot);

			try {
				fs.unlinkSync(tmpZip);
			} catch {}
		},
	);
}
