// lightweight validator for UX: lowercase, must start with a letter. An optional ~swap, ~flash
// or ~ram suffix is xtask memory-region syntax rather than part of the name.
export function isLikelyValidAppName(name: string): boolean {
	return /^[a-z][a-z0-9_-]*(~(swap|flash|ram))?$/.test(name);
}

/** Split the space-separated app/crate setting into names, ignoring stray whitespace. */
export function splitAppNames(value: string | undefined): string[] {
	return (value ?? '').trim().split(/\s+/).filter(Boolean);
}
