import * as assert from 'node:assert';
import { createStatusBarItems } from '@views/statusBar';
import type * as vscode from 'vscode';

suite('Status bar items', () => {
	test('creates twelve items, each named, command-wired, and tracked for disposal', () => {
		const subscriptions: { dispose(): unknown }[] = [];
		const ctx = { subscriptions } as unknown as vscode.ExtensionContext;

		const items = createStatusBarItems(ctx);
		try {
			const all = Object.values(items);
			assert.equal(all.length, 12, 'twelve status bar items');
			assert.equal(subscriptions.length, 12, 'every item is pushed to context.subscriptions');

			// Each name identifies its entry in the status bar context menu and to screen readers,
			// so every item must carry one, prefixed with the extension name, with no duplicates.
			const names = all.map((i) => String(i.name));
			assert.equal(new Set(names).size, all.length, `names are unique: ${names.join(', ')}`);
			for (const item of all) {
				assert.ok(item.name?.startsWith('Baochip'), `"${item.name}" identifies the extension`);
				assert.ok(
					String(item.command).startsWith('baochip.'),
					`"${item.name}" runs a baochip command`,
				);
			}

			// Declaration order is the on-screen left-to-right order (higher priority = further left).
			const priorities = all.map((i) => i.priority ?? 0);
			for (let i = 1; i < priorities.length; i++) {
				assert.ok(
					priorities[i - 1] > priorities[i],
					`priorities strictly descending: ${priorities.join(', ')}`,
				);
			}
		} finally {
			for (const d of subscriptions) d.dispose();
		}
	});
});
