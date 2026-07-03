import { resolveXousRootOrNotify } from '@services/pathService';
import { getOutOfTreeRoot, getProjectMode } from '@services/projectModeService';
import { ensureNamedTerminal } from '@services/terminalService';
import * as vscode from 'vscode';

export function registerCleanCommand(_context: vscode.ExtensionContext) {
	return vscode.commands.registerCommand('baochip.clean', async () => {
		let root: string;

		if (getProjectMode() === 'out-of-tree') {
			const ootRoot = getOutOfTreeRoot();
			if (!ootRoot) return;
			root = ootRoot;
		} else {
			const resolved = await resolveXousRootOrNotify();
			if (!resolved) return;
			root = resolved;
		}

		const term = ensureNamedTerminal(vscode.l10n.t('Bao Clean'));
		term.sendText(`cd "${root}"`);
		term.sendText('cargo clean');
		term.show(true);
	});
}
