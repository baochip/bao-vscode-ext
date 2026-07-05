import assert from 'node:assert/strict';
import { test } from 'node:test';
import { escapeHtml } from '../../util/html';

test('escapeHtml: neutralizes every markup-active character', () => {
	assert.equal(
		escapeHtml(`<img src=x onerror="pwn('&')">`),
		'&lt;img src=x onerror=&quot;pwn(&#39;&amp;&#39;)&quot;&gt;',
	);
});

test('escapeHtml: escapes & first so entities are not double-mangled', () => {
	assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

test('escapeHtml: leaves plain translated text untouched', () => {
	for (const s of ['Welcome to Baochip', 'ようこそ', 'Schnellaktionen fur den Start.', '']) {
		assert.equal(escapeHtml(s), s);
	}
});
