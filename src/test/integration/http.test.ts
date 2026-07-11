import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { downloadFile, fetchETag, fetchJson } from '@services/httpService';
import { cleanupTmpDirs, tmpDir } from './helpers';

/** Start a throwaway loopback HTTP server; httpService allows plain http for loopback only. */
async function serve(
	handler: http.RequestListener,
): Promise<{ base: string; close: () => Promise<void> }> {
	const server = http.createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	return {
		base: `http://127.0.0.1:${port}`,
		close: () => new Promise((resolve) => server.close(() => resolve())),
	};
}

suite('httpService against a local server', () => {
	teardown(() => cleanupTmpDirs());

	test('fetchJson returns the parsed body for a plain 200', async () => {
		const srv = await serve((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end('{"ok":true}');
		});
		try {
			assert.deepEqual(await fetchJson(`${srv.base}/x.json`), { ok: true });
		} finally {
			await srv.close();
		}
	});

	test('fetchJson decodes a multibyte body split across chunks', async () => {
		const value = 'あ'.repeat(20000); // 3-byte chars so a byte split lands mid-character
		const body = Buffer.from(JSON.stringify({ msg: value }), 'utf8');
		const mid = Math.floor(body.length / 2);
		const srv = await serve((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.write(body.subarray(0, mid));
			// Second write on a later tick so the client sees two chunks split mid-character.
			setTimeout(() => {
				res.write(body.subarray(mid));
				res.end();
			}, 5);
		});
		try {
			assert.deepEqual(await fetchJson(`${srv.base}/x.json`), { msg: value });
		} finally {
			await srv.close();
		}
	});

	test('fetchJson follows a 307 with a relative Location', async () => {
		const srv = await serve((req, res) => {
			if (req.url === '/start') {
				res.writeHead(307, { Location: '/final' });
				res.end();
			} else {
				res.writeHead(200);
				res.end('{"followed":true}');
			}
		});
		try {
			assert.deepEqual(await fetchJson(`${srv.base}/start`), { followed: true });
		} finally {
			await srv.close();
		}
	});

	test('a redirect loop rejects instead of recursing forever', async () => {
		const srv = await serve((_req, res) => {
			res.writeHead(302, { Location: '/again' });
			res.end();
		});
		try {
			await assert.rejects(fetchJson(`${srv.base}/loop`), /Too many redirects/);
		} finally {
			await srv.close();
		}
	});

	test('a redirect with an unparseable Location rejects instead of hanging', async () => {
		// 'http://' has a special scheme but no host, so new URL() throws while resolving it;
		// unguarded, that throw escapes the response callback and the promise never settles.
		const srv = await serve((_req, res) => {
			res.writeHead(302, { Location: 'http://' });
			res.end();
		});
		try {
			await assert.rejects(fetchJson(`${srv.base}/bad-redirect`));
		} finally {
			await srv.close();
		}
	});

	test('downloadFile writes the body and leaves no temp file', async () => {
		const srv = await serve((_req, res) => {
			res.writeHead(200, { 'Content-Length': '9' });
			res.end('uf2 bytes');
		});
		const dest = path.join(tmpDir(), 'kernel.uf2');
		try {
			await downloadFile(`${srv.base}/kernel.uf2`, dest);
			assert.equal(fs.readFileSync(dest, 'utf8'), 'uf2 bytes');
			assert.deepEqual(
				fs.readdirSync(path.dirname(dest)).filter((f) => f.includes('.partial')),
				[],
				'no temp file left behind',
			);
		} finally {
			await srv.close();
		}
	});

	test('downloadFile settles on a mid-body connection drop and leaves no truncated file', async () => {
		const srv = await serve((_req, res) => {
			res.writeHead(200, { 'Content-Length': '1000000' });
			res.write('only a few bytes');
			setTimeout(() => res.destroy(), 10); // server kills the socket mid-transfer
		});
		const dest = path.join(tmpDir(), 'kernel.uf2');
		fs.writeFileSync(dest, 'previous good kernel');
		try {
			await assert.rejects(downloadFile(`${srv.base}/kernel.uf2`, dest));
			assert.equal(fs.readFileSync(dest, 'utf8'), 'previous good kernel', 'old file survives');
			assert.deepEqual(
				fs.readdirSync(path.dirname(dest)).filter((f) => f.includes('.partial')),
				[],
				'no partial left',
			);
		} finally {
			await srv.close();
		}
	});

	test('downloadFile rejects a non-200 without creating a file', async () => {
		const srv = await serve((_req, res) => {
			res.writeHead(500);
			res.end('boom');
		});
		const dest = path.join(tmpDir(), 'kernel.uf2');
		try {
			await assert.rejects(downloadFile(`${srv.base}/kernel.uf2`, dest), /HTTP 500/);
			assert.equal(fs.existsSync(dest), false);
		} finally {
			await srv.close();
		}
	});

	test('fetchETag follows a redirect to the final ETag', async () => {
		const srv = await serve((req, res) => {
			if (req.url === '/moved') {
				res.writeHead(302, { Location: '/real' });
				res.end();
			} else {
				res.writeHead(200, { ETag: '"abc123"' });
				res.end();
			}
		});
		try {
			assert.equal(await fetchETag(`${srv.base}/moved`), '"abc123"');
		} finally {
			await srv.close();
		}
	});

	test('fetchETag returns null on a server error instead of a bogus value', async () => {
		const srv = await serve((_req, res) => {
			res.writeHead(500, { ETag: '"should-be-ignored"' });
			res.end();
		});
		try {
			assert.equal(await fetchETag(`${srv.base}/broken`), null);
		} finally {
			await srv.close();
		}
	});

	test('plain http to a non-loopback host is refused', async () => {
		await assert.rejects(fetchJson('http://example.com/x.json'), /Only https URLs/);
	});
});
