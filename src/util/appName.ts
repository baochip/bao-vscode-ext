// lightweight validator for UX: lowercase, must start with a letter
export function isLikelyValidAppName(name: string): boolean {
	return /^[a-z][a-z0-9_-]*$/.test(name);
}
