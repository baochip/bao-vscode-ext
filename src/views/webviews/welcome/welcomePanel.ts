import * as vscode from 'vscode';
import { getXousCorePath, getDefaultBaud, getBuildTarget, getFlashLocation, getBootloaderSerialPort, getRunSerialPort } from '@services/configService';

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
      vscode.l10n.t('Welcome • Baochip'), // "Welcome • Baochip"
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'src', 'views', 'webviews', 'welcome'),
          vscode.Uri.joinPath(context.extensionUri, 'src', 'views', 'webviews', 'monitor'),
          vscode.Uri.joinPath(context.extensionUri, 'media'),
          vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
        ],
      }
    );

    WelcomePanel.current = new WelcomePanel(panel, context);
  }

  private constructor(panel: vscode.WebviewPanel, private readonly ctx: vscode.ExtensionContext) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    const logoUri = vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'logo.svg');
    this.panel.iconPath = logoUri;
    this.refreshState();

    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.type === 'setShowOnStartup' && typeof msg.value === 'boolean') {
        await vscode.workspace.getConfiguration()
          .update('baochip.showWelcomeOnStartup', msg.value, vscode.ConfigurationTarget.Workspace);
        return;
      }

      if (msg?.type === 'xousSite') {
        vscode.env.openExternal(vscode.Uri.parse('https://github.com/betrusted-io/xous-core'));
        return;
      }
      if (msg?.type === 'extRepo') {
        vscode.env.openExternal(vscode.Uri.parse('https://github.com/baochip/bao-vscode-ext/issues'));
        return;
      }

      if (msg?.type === 'run') {
        switch (msg.cmd) {
          case 'configure':
            vscode.commands.executeCommand('baochip.openSettings');
            break;
          case 'selectApp':
            vscode.commands.executeCommand('baochip.selectApp');
            break;
          case 'createApp':
            vscode.commands.executeCommand('baochip.createApp');
            break;
        }
        return;
      }
    }, null, this.disposables);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private refreshState() {
    const cfg = vscode.workspace.getConfiguration();
    const state = {
      xousCorePath: getXousCorePath(),
      bootloaderSerialPort: getBootloaderSerialPort(),
      runSerialPort: getRunSerialPort(),
      baud: getDefaultBaud(),
      flashLocation: getFlashLocation(),
      target: getBuildTarget(),
      showOnStartup: cfg.get<boolean>('baochip.showWelcomeOnStartup', true),
    };
    this.panel.webview.postMessage({ type: 'init', state });
  }

  dispose() {
    this.disposables.forEach(d => d.dispose());
    try { this.panel.dispose(); } catch {}
    WelcomePanel.current = undefined;
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const csp = webview.cspSource;

    const codiconsCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
    );
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'src', 'views', 'webviews', 'welcome', 'welcome.css'));
    const jsUri  = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'src', 'views', 'webviews', 'welcome', 'welcome.js'));
    const logoUri = webview.asWebviewUri(vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'logo.svg'));

    // Localized strings injected into the HTML
    const titleBar = vscode.l10n.t('Welcome • Baochip'); // "Welcome • Baochip"
    const h1 = vscode.l10n.t('Welcome to Baochip'); // "Welcome to Baochip"
    const sub = vscode.l10n.t('Quick actions to get you started.'); // "Quick actions to get you started."
    const chkLabel = vscode.l10n.t('Show Welcome on extension startup'); // "Show Welcome on extension startup"
    const xousLinkTitle = vscode.l10n.t('Open xous-core on GitHub'); // "Open xous-core on GitHub"
    const xousLinkText = 'betrusted-io/xous-core'; // keep repo slug literal
    const btnConfigureTitle = vscode.l10n.t('Configure extension');
    const btnConfigureSub = vscode.l10n.t('Paths, ports, defaults');
    const btnCreateTitle = vscode.l10n.t('Create new app');
    const btnCreateSub = vscode.l10n.t('Scaffold in apps-dabao/');
    const btnSelectTitle = vscode.l10n.t('Select app');
    const btnSelectSub = vscode.l10n.t('Choose from apps-dabao/');
    const footerLead = vscode.l10n.t('Found a bug or have a feature request for the extension?');
    const footerLink = vscode.l10n.t('Open an issue on GitHub'); // "Open an issue on GitHub"

    return /* html */`
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
                  <a class="link" href="javascript:void(0)" id="btn-xousSite" title="${xousLinkTitle}">
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

            <button id="btn-selectApp" class="btn">
              <span class="icon codicon codicon-folder"></span>
              <div class="title">${btnSelectTitle}</div>
              <div class="subtitle">${btnSelectSub}</div>
            </button>
          </div>

          <footer class="muted" style="margin-top: 1rem; text-align: center;">
            <p>
              ${footerLead}
              <br>
              <a class="link" href="javascript:void(0)" id="btn-extRepo">
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
