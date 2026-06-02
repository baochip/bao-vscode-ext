import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as https from 'node:https';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

const XOUS_TARGET = 'riscv32imac-unknown-xous-elf';
const BETRUSTED_RUST_RELEASES = 'https://api.github.com/repos/betrusted-io/rust/releases';

/** Check if the Xous target is already installed in the current rustc sysroot. */
export function isXousToolkitInstalled(): boolean {
	const r = spawnSync('rustc', ['--print', 'sysroot'], { encoding: 'utf8' });
	if (!r.stdout) return false;
	const xousDir = path.join(r.stdout.trim(), 'lib', 'rustlib', XOUS_TARGET);
	return fs.existsSync(xousDir);
}

/** Derive the host rustup triple from Node's process info. */
function hostTriple(): string {
	const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
	if (process.platform === 'win32') return `${arch}-pc-windows-msvc`;
	if (process.platform === 'darwin') return `${arch}-apple-darwin`;
	return `${arch}-unknown-linux-gnu`;
}

/** Fetch JSON from a URL, following up to one redirect. */
function fetchJson(url: string): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const req = https.get(url, { headers: { 'User-Agent': 'bao-vscode-ext' } }, (res) => {
			if (res.statusCode === 301 || res.statusCode === 302) {
				const location = res.headers.location;
				if (!location) return reject(new Error(`Redirect with no Location from ${url}`));
				res.resume();
				fetchJson(location).then(resolve).catch(reject);
				return;
			}
			let data = '';
			res.on('data', (chunk: Buffer) => {
				data += chunk.toString();
			});
			res.on('end', () => {
				try {
					resolve(JSON.parse(data));
				} catch {
					reject(new Error(`Failed to parse JSON from ${url}`));
				}
			});
		});
		req.on('error', reject);
		req.setTimeout(15000, () => {
			req.destroy();
			reject(new Error('GitHub API request timed out.'));
		});
	});
}

/** Download a file to dest, following redirects. */
function downloadFile(url: string, dest: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const follow = (u: string) => {
			https
				.get(u, { headers: { 'User-Agent': 'bao-vscode-ext' } }, (res) => {
					if (res.statusCode === 301 || res.statusCode === 302) {
						const location = res.headers.location;
						if (!location) {
							reject(new Error(`Redirect with no Location`));
							return;
						}
						res.resume();
						follow(location);
						return;
					}
					if (res.statusCode !== 200) {
						reject(new Error(`HTTP ${res.statusCode} for ${u}`));
						return;
					}
					const file = fs.createWriteStream(dest);
					res.pipe(file);
					file.on('finish', () => file.close(() => resolve()));
					file.on('error', (err) => {
						file.close();
						try {
							fs.unlinkSync(dest);
						} catch {}
						reject(err);
					});
				})
				.on('error', reject);
		};
		follow(url);
	});
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
	const verMatch = rustcVer.stdout.match(/rustc (\d+\.\d+\.\d+)/);
	if (!verMatch) throw new Error('Could not determine rustc version');
	const rustVersion = verMatch[1]; // e.g. "1.87.0"

	const sysrootResult = spawnSync('rustc', ['--print', 'sysroot'], { encoding: 'utf8' });
	const sysroot = sysrootResult.stdout.trim();
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
					(typeof name === 'string' && name.split('_')[0] === XOUS_TARGET.split('-')[0]) ||
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
