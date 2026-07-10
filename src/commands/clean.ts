import { Commands } from '@commands/commandIds';
import { withCommand } from '@commands/withCommand';
import { getOutOfTreeRoot, getProjectMode } from '@services/projectModeService';
import { ensureNamedTerminal } from '@services/terminalService';
import { resolveXousRootOrNotify } from '@services/xousCoreService';
import * as vscode from 'vscode';

export function registerCleanCommand() {
	return withCommand(Commands.clean, async () => {
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

		// Modal: the status bar trash sits next to the constantly-clicked build/flash icons, and a
		// stray cargo clean silently costs a full rebuild.
		const cleanLabel = vscode.l10n.t('Clean');
		const clicked = await vscode.window.showWarningMessage(
			vscode.l10n.t('Run cargo clean?'),
			{
				modal: true,
				detail: vscode.l10n.t(
					'This deletes all build output under {0}. The next build recompiles everything from scratch.',
					root,
				),
			},
			cleanLabel,
		);
		if (clicked !== cleanLabel) return;

		const term = ensureNamedTerminal(vscode.l10n.t('Baochip Clean'), root);
		term.sendText('cargo clean');
		term.show(true);
	});
}
