import * as fs from 'node:fs';
import * as https from 'node:https';

const UA = { 'User-Agent': 'bao-vscode-ext' };
const DEFAULT_TIMEOUT_MS = 15000;

/** GET a URL following redirects; resolves the response body as text. Rejects on non-2xx, error, or timeout. */
function getText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
	return new Promise((resolve, reject) => {
		const req = https.get(url, { headers: UA }, (res) => {
			const status = res.statusCode ?? 0;
			if (status === 301 || status === 302) {
				res.resume();
				const location = res.headers.location;
				if (!location) return reject(new Error(`Redirect with no Location from ${url}`));
				getText(location, timeoutMs).then(resolve, reject);
				return;
			}
			if (status < 200 || status >= 300) {
				res.resume();
				return reject(new Error(`HTTP ${status} for ${url}`));
			}
			let data = '';
			res.on('data', (chunk: Buffer) => {
				data += chunk.toString();
			});
			res.on('end', () => resolve(data));
		});
		req.on('error', reject);
		req.setTimeout(timeoutMs, () => {
			req.destroy();
			reject(new Error(`Request timed out: ${url}`));
		});
	});
}

/** GET and parse JSON, following redirects. */
export async function fetchJson(url: string, timeoutMs?: number): Promise<unknown> {
	const text = await getText(url, timeoutMs);
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`Failed to parse JSON from ${url}`);
	}
}

/** Download a URL to `dest`, following redirects. Removes the partial file on failure. */
export function downloadFile(
	url: string,
	dest: string,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const follow = (u: string) => {
			const req = https.get(u, { headers: UA }, (res) => {
				const status = res.statusCode ?? 0;
				if (status === 301 || status === 302) {
					res.resume();
					const location = res.headers.location;
					if (!location) return reject(new Error(`Redirect with no Location from ${u}`));
					follow(location);
					return;
				}
				if (status !== 200) {
					res.resume();
					return reject(new Error(`HTTP ${status} for ${u}`));
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
			});
			req.on('error', reject);
			req.setTimeout(timeoutMs, () => {
				req.destroy();
				reject(new Error(`Download timed out: ${u}`));
			});
		};
		follow(url);
	});
}

/** HEAD a URL and return its ETag header, or null on any failure. */
export function fetchETag(url: string, timeoutMs = 5000): Promise<string | null> {
	return new Promise((resolve) => {
		const req = https.request(url, { method: 'HEAD', headers: UA }, (res) => {
			resolve((res.headers.etag as string) ?? null);
		});
		req.on('error', () => resolve(null));
		req.setTimeout(timeoutMs, () => {
			req.destroy();
			resolve(null);
		});
		req.end();
	});
}
