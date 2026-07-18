/** Extract the semver (e.g. "1.87.0") from `rustc --version` output, or null if not found. */
export function parseRustcVersion(stdout: string): string | null {
	const m = stdout.match(/rustc (\d+\.\d+\.\d+)/);
	return m ? m[1] : null;
}

/**
 * Index of the release tag with the highest numeric patch suffix after `version`
 * (e.g. "1.87.0.2" beats "1.87.0.1" for version "1.87.0"; a bare "1.87.0" counts as patch 0).
 * Tags without a parsable ".N" suffix rank lowest, and ties keep the earliest index, so with a
 * newest-first release list (GitHub's order) the newest release wins when no patch is parsable.
 */
export function pickHighestPatchIndex(tags: string[], version: string): number {
	let best = 0;
	let bestPatch = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < tags.length; i++) {
		const rest = tags[i].startsWith(version) ? tags[i].slice(version.length) : null;
		const m = rest === null ? null : /^\.(\d+)$/.exec(rest);
		const patch = m ? Number(m[1]) : rest === '' ? 0 : -1;
		if (patch > bestPatch) {
			best = i;
			bestPatch = patch;
		}
	}
	return best;
}

/**
 * Select the host-independent Xous `rust-std` asset from a release's asset list. The
 * betrusted-io/rust releases publish one zip per target, named "<target>_<version>.zip" with the
 * "-elf" suffix dropped (e.g. riscv32imac-unknown-xous_1.97.1.zip for riscv32imac-unknown-xous-elf).
 * Returns undefined when no such asset is present.
 */
export function selectXousToolkitAsset<T extends { name?: unknown }>(
	assets: T[],
	target: string,
): T | undefined {
	const prefix = target.replace(/-elf$/, ''); // riscv32imac-unknown-xous
	return assets.find(
		(a) => typeof a.name === 'string' && a.name.startsWith(prefix) && a.name.endsWith('.zip'),
	);
}

/**
 * Classify a cargo/rustc build failure caused by a missing host C/C++ toolchain, from its output.
 * The signatures are Windows-specific: `link.exe` is the MSVC linker (needs the Visual Studio C++
 * Build Tools), while `dlltool`/`gcc.exe` belong to MinGW-w64 (the Rust GNU toolchain). Returns
 * undefined when the failure is something else.
 */
export function detectHostToolchainGap(output: string): 'mingw' | 'msvc' | undefined {
	const o = output.toLowerCase();
	if (!o.includes('not found')) return undefined;
	if (o.includes('dlltool') || o.includes('gcc.exe')) return 'mingw';
	if (o.includes('link.exe')) return 'msvc';
	return undefined;
}
