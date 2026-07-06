import { Commands } from '@commands/commandIds';
import { XOUS_CORE_REPO } from '@constants';
import { getShowWelcome, setShowWelcome } from '@services/configService';
import { log } from '@services/logService';
import { toMessage } from '@util/error';
import { escapeHtml } from '@util/html';
import * as vscode from 'vscode';

export class WelcomePanel {
	public static current: WelcomePanel | undefined;
	private panel: vscode.WebviewPanel;
	private disposables: vscode.Disposable[] = [];

	static show(context: vscode.ExtensionContext) {
		if (WelcomePanel.current) {
			WelcomePanel.current.panel.reveal(vscode.ViewColumn.Active);
			WelcomePanel.current.refreshState();
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			'baoWelcome',
			vscode.l10n.t('Welcome - Baochip'),
			vscode.ViewColumn.Active,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(context.extensionUri, 'media'),
					vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
				],
			},
		);

		WelcomePanel.current = new WelcomePanel(panel, context);
	}

	private constructor(
		panel: vscode.WebviewPanel,
		private readonly ctx: vscode.ExtensionContext,
	) {
		this.panel = panel;
		this.panel.webview.html = this.getHtml();
		const logoUri = vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'logo.svg');
		this.panel.iconPath = logoUri;
		this.refreshState();

		this.panel.webview.onDidReceiveMessage(
			async (msg) => {
				try {
					if (msg?.type === 'setShowOnStartup' && typeof msg.value === 'boolean') {
						await setShowWelcome(msg.value);
					} else if (msg?.type === 'xousSite') {
						await vscode.env.openExternal(vscode.Uri.parse(XOUS_CORE_REPO));
					} else if (msg?.type === 'extRepo') {
						await vscode.env.openExternal(
							vscode.Uri.parse('https://github.com/baochip/bao-vscode-ext/issues'),
						);
					} else if (msg?.type === 'run' && msg.cmd === 'configure') {
						await vscode.commands.executeCommand(Commands.openSettings);
					} else if (msg?.type === 'run' && msg.cmd === 'createApp') {
						await vscode.commands.executeCommand(Commands.createApp);
					}
				} catch (e) {
					log(`Welcome action failed: ${toMessage(e)}`);
				}
			},
			null,
			this.disposables,
		);

		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
	}

	private refreshState() {
		const state = { showOnStartup: getShowWelcome() };
		this.panel.webview.postMessage({ type: 'init', state });
	}

	dispose() {
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
		try {
			this.panel.dispose();
		} catch {}
		WelcomePanel.current = undefined;
	}

	private getHtml(): string {
		const webview = this.panel.webview;
		const csp = webview.cspSource;

		const codiconsCssUri = webview.asWebviewUri(
			vscode.Uri.joinPath(
				this.ctx.extensionUri,
				'node_modules',
				'@vscode',
				'codicons',
				'dist',
				'codicon.css',
			),
		);
		const cssUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'css', 'welcome.css'),
		);
		const jsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'js', 'welcome.js'),
		);
		const logoUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'logo.svg'),
		);

		// Localized strings injected into the HTML - escaped so a translation containing markup
		// characters can never alter the page structure (defense-in-depth; the CSP is already tight).
		const titleBar = escapeHtml(vscode.l10n.t('Welcome - Baochip')); // "Welcome - Baochip"
		const h1 = escapeHtml(vscode.l10n.t('Welcome to Baochip')); // "Welcome to Baochip"
		const sub = escapeHtml(vscode.l10n.t('Quick actions to get you started.')); // "Quick actions to get you started."
		const chkLabel = escapeHtml(vscode.l10n.t('Show Welcome on extension startup')); // "Show Welcome on extension startup"
		const xousLinkTitle = escapeHtml(vscode.l10n.t('Open xous-core on GitHub')); // "Open xous-core on GitHub"
		const xousLinkText = 'betrusted-io/xous-core'; // keep repo slug literal
		const btnConfigureTitle = escapeHtml(vscode.l10n.t('Configure extension'));
		const btnConfigureSub = escapeHtml(vscode.l10n.t('Paths, ports, defaults'));
		const btnCreateTitle = escapeHtml(vscode.l10n.t('Create new app'));
		const btnCreateSub = escapeHtml(vscode.l10n.t('Start a new app from a template'));
		const footerLead = escapeHtml(
			vscode.l10n.t('Found a bug or have a feature request for the extension?'),
		);
		const footerLink = escapeHtml(vscode.l10n.t('Open an issue on GitHub')); // "Open an issue on GitHub"

		return /* html */ `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                  img-src ${csp} https: data:;
                  style-src ${csp};
                  script-src ${csp};
                  font-src ${csp};">
        <link rel="stylesheet" href="${codiconsCssUri}">
        <link rel="stylesheet" href="${cssUri}">
        <title>${titleBar}</title>
      </head>
      <body>
        <div class="wrap">
          <header>
            <img src="${logoUri}" alt="Baochip logo" />
            <div class="stack">
              <h1>${h1}</h1>
              <p class="muted">${sub}</p>
              <div class="toolbar">
                <div class="opts">
                  <label>
                    <input id="chk-startup" type="checkbox" checked />
                    ${chkLabel}
                  </label>
                </div>

                <div class="spacer"></div>

                <div class="links">
                  <a class="link" href="#" id="btn-xousSite" title="${xousLinkTitle}">
                    <span class="icon codicon codicon-github-inverted"></span>
                    ${xousLinkText}
                  </a>
                </div>
              </div>
            </div>
          </header>

          <div class="grid">
            <button id="btn-configure" class="btn">
              <span class="icon codicon codicon-gear"></span>
              <div class="title">${btnConfigureTitle}</div>
              <div class="subtitle">${btnConfigureSub}</div>
            </button>

            <button id="btn-createApp" class="btn">
              <span class="icon codicon codicon-add"></span>
              <div class="title">${btnCreateTitle}</div>
              <div class="subtitle">${btnCreateSub}</div>
            </button>
          </div>

          <footer class="muted" style="margin-top: 1rem; text-align: center;">
            <p>
              ${footerLead}
              <br>
              <a class="link" href="#" id="btn-extRepo">
                <span class="icon codicon codicon-feedback"></span> ${footerLink}
              </a>
            </p>
          </footer>

          <script src="${jsUri}"></script>
        </div>
      </body>
      </html>`;
	}
}
