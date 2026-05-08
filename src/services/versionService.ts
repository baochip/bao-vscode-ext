import * as fs from 'node:fs';
import * as path from 'node:path';
import { REQUIRED_TOOLS_BAO } from '@constants';
import { ensureXousCorePath } from '@services/pathService';
import * as vscode from 'vscode';

function parseSemver(s: string): [number, number, number] | null {
	const m = s.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
	if (!m) return null;
	return [Number.parseInt(m[1], 10), Number.parseInt(m[2], 10), Number.parseInt(m[3], 10)];
}

function cmpSemver(a: string, b: string): number {
	const A = parseSemver(a);
	const B = parseSemver(b);
	if (!A || !B) return -1;
	for (let i = 0; i < 3; i++) {
		if (A[i] !== B[i]) return A[i] - B[i];
	}
	return 0;
}

/** Read the tools-bao version from the VERSION constant in bao.py. */
function readBaoVersion(xousRoot: string): string | null {
	const baoPy = path.join(xousRoot, 'tools-bao', 'bao.py');
	try {
		const content = fs.readFileSync(baoPy, 'utf8');
		const m = content.match(/^VERSION\s*=\s*["'](\d+\.\d+\.\d+)["']/m);
		return m ? m[1] : null;
	} catch {
		return null;
	}
}

/**
 * Read bao.py VERSION and compare against REQUIRED_TOOLS_BAO.
 */
export async function checkToolsBaoVersion(xousRootPromise?: Promise<string>): Promise<boolean> {
	const xousRoot = await (xousRootPromise ?? ensureXousCorePath()).catch(() => undefined);
	if (!xousRoot) return false;

	const found = readBaoVersion(xousRoot);

	if (!found) {
		vscode.window.showErrorMessage(
			vscode.l10n.t(
				'Could not check tools-bao version. Please ensure your xous-core repository is up to date.\nError: {0}',
				'VERSION not found in tools-bao/bao.py',
			),
		);
		return false;
	}

	if (cmpSemver(found, REQUIRED_TOOLS_BAO) < 0) {
		vscode.window.showErrorMessage(
			vscode.l10n.t(
				'Your tools-bao is too old (found v{0}, need ≥ v{1}).\nPlease update your xous-core repository to continue.',
				found,
				REQUIRED_TOOLS_BAO,
			),
		);
		return false;
	}

	return true;
}
