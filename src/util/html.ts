/**
 * Escape a string for safe interpolation into HTML text content or double-quoted attribute
 * values. Rendering is unchanged for plain text (entities display as the original characters).
 */
export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}
