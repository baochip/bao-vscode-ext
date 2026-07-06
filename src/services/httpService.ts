import * as nodeHttp from 'node:http';
import * as https from 'node:https';
import { writeStreamToFile } from '@util/stream';

const UA = { 'User-Agent': 'bao-vscode-ext' };
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;

function isRedirect(status: number): boolean {
	return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Pick the transport for a URL. Real traffic is HTTPS-only; plain http: is allowed solely for
 * loopback hosts so tests can run against a local server.
 */
function transportFor(u: URL): typeof https {
	if (u.protocol === 'https:') return https;
	const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1';
	if (u.protocol === 'http:' && loopback) {
		// node:http's request() shape is compatible for our GET/HEAD use
		return nodeHttp as unknown as typeof https;
	}
	throw new Error(`Only https URLs are supported: ${u}`);
}

/**
 * Issue a GET/HEAD and resolve the final response after following redirects
 * (301/302/303/307/308, relative Locations resolved, capped at MAX_REDIRECTS hops).
 * Rejects on request error, timeout, redirect loop, or a redirect with no Location.
 * Status handling of the final response is the caller's job.
 */
function requestWithRedirects(
	url: string,
	opts: { method?: 'GET' | 'HEAD'; timeoutMs?: number } = {},
): Promise<nodeHttp.IncomingMessage> {
	const { method = 'GET', timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
	return new Promise((resolve, reject) => {
		const go = (u: string, hops: number) => {
			let parsed: URL;
			let transport: typeof https;
			try {
				parsed = new URL(u);
				transport = transportFor(parsed);
			} catch (e) {
				return reject(e instanceof Error ? e : new Error(String(e)));
			}
			const req = transport.request(parsed, { method, headers: UA }, (res) => {
				const status = res.statusCode ?? 0;
				if (isRedirect(status)) {
					res.resume();
					const location = res.headers.location;
					if (!location) return reject(new Error(`Redirect with no Location from ${u}`));
					if (hops >= MAX_REDIRECTS) return reject(new Error(`Too many redirects for ${url}`));
					let next: string;
					try {
						next = new URL(location, u).toString(); // Location may be relative
					} catch (e) {
						// a malformed Location would otherwise throw inside this response callback,
						// escaping the promise so it never settles (the caller hangs forever)
						return reject(e instanceof Error ? e : new Error(String(e)));
					}
					go(next, hops + 1);
					return;
				}
				resolve(res);
			});
			req.on('error', reject);
			req.setTimeout(timeoutMs, () => {
				req.destroy();
				reject(new Error(`Request timed out: ${u}`));
			});
			req.end();
		};
		go(url, 0);
	});
}

/** GET a URL following redirects; resolves the response body as text. Rejects on non-2xx, error, or timeout. */
async function getText(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
	const res = await requestWithRedirects(url, { timeoutMs });
	const status = res.statusCode ?? 0;
	if (status < 200 || status >= 300) {
		res.resume();
		throw new Error(`HTTP ${status} for ${url}`);
	}
	return await new Promise((resolve, reject) => {
		let data = '';
		res.on('data', (chunk: Buffer) => {
			data += chunk.toString();
		});
		res.on('end', () => resolve(data));
		res.on('error', reject); // a mid-body connection drop must settle, not hang
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

/**
 * Download a URL to `dest`, following redirects. Bytes land in a temp file that is renamed onto
 * `dest` only when the transfer completes, so a dropped connection never leaves a truncated
 * file at `dest` (a previous good copy survives) and the promise always settles.
 */
export async function downloadFile(
	url: string,
	dest: string,
	timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
	const res = await requestWithRedirects(url, { timeoutMs });
	const status = res.statusCode ?? 0;
	if (status !== 200) {
		res.resume();
		throw new Error(`HTTP ${status} for ${url}`);
	}
	await writeStreamToFile(res, dest);
}

/**
 * HEAD a URL (following redirects) and return the final response's ETag.
 * Null on non-2xx or any failure - callers treat null as "could not determine".
 */
export async function fetchETag(url: string, timeoutMs = 5000): Promise<string | null> {
	try {
		const res = await requestWithRedirects(url, { method: 'HEAD', timeoutMs });
		res.resume();
		const status = res.statusCode ?? 0;
		if (status < 200 || status >= 300) return null;
		return (res.headers.etag as string) ?? null;
	} catch {
		return null;
	}
}
