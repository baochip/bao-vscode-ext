import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';
import { Commands } from '../../commands/commandIds';

// Static guard: the Commands const (the TypeScript source of truth) and the package.json
// manifest must declare exactly the same command IDs.

const ROOT = path.resolve(__dirname, '..', '..', '..');

function manifestCommandIds(): string[] {
	const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
		contributes: { commands: { command: string }[] };
	};
	return manifest.contributes.commands.map((c) => c.command);
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
