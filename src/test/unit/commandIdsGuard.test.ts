import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { Commands } from '../../commands/commandIds';

// Static guard: the Commands const (the TypeScript source of truth) and the package.json
// manifest must declare exactly the same command IDs.

const ROOT = path.resolve(__dirname, '..', '..', '..');

function manifest(): {
	contributes: { commands: { command: string }[]; keybindings: { command: string; key: string }[] };
} {
	return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
}

function manifestCommandIds(): string[] {
	return manifest().contributes.commands.map((c) => c.command);
}

test('commands: every Commands entry is declared in package.json', () => {
	const declared = new Set(manifestCommandIds());
	const missing = Object.values(Commands)
		.filter((id) => !declared.has(id))
		.sort();
	assert.deepEqual(missing, [], 'IDs in Commands but not in package.json');
});

test('commands: every package.json command exists in Commands', () => {
	const known = new Set<string>(Object.values(Commands));
	const missing = manifestCommandIds()
		.filter((id) => !known.has(id))
		.sort();
	assert.deepEqual(missing, [], 'IDs in package.json but not in Commands');
});

test('keybindings: every binding names a contributed command, each with a distinct key', () => {
	const declared = new Set(manifestCommandIds());
	const bindings = manifest().contributes.keybindings;
	assert.ok(
		bindings.length >= 3,
		`sanity: expected the build/flash/B-F-M bindings, found ${bindings.length}`,
	);
	const unknown = bindings.filter((b) => !declared.has(b.command)).map((b) => b.command);
	assert.deepEqual(unknown, [], 'keybindings referencing undeclared commands');
	const keys = bindings.map((b) => b.key);
	assert.equal(new Set(keys).size, keys.length, `duplicate keys: ${keys.join(', ')}`);
});
