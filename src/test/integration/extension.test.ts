import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Extension smoke', () => {
	test('activates and registers every contributed command', async () => {
		const ext = vscode.extensions.getExtension('baochip.bao-vscode-ext');
		assert.ok(ext, 'extension should be present');
		await ext.activate();

		const registered = new Set(await vscode.commands.getCommands(true));
		const declared: string[] = ext.packageJSON.contributes.commands.map(
			(c: { command: string }) => c.command,
		);
		for (const command of declared) {
			assert.ok(registered.has(command), `command not registered: ${command}`);
		}
	});
});
