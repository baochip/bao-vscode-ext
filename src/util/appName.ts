// lightweight validator for UX: lowercase, must start with a letter. An optional ~swap, ~flash
// or ~ram suffix is xtask memory-region syntax rather than part of the name.
export function isLikelyValidAppName(name: string): boolean {
	return /^[a-z][a-z0-9_-]*(~(swap|flash|ram))?$/.test(name);
}

/** The crate an app entry names, without the xtask region suffix: dc34-console~flash -> dc34-console. */
export function crateNameOf(appName: string): string {
	return appName.split('~')[0];
}

/** Split the space-separated app/crate setting into names, ignoring stray whitespace. */
export function splitAppNames(value: string | undefined): string[] {
	return (value ?? '').trim().split(/\s+/).filter(Boolean);
}
