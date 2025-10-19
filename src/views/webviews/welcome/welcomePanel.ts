import * as vscode from 'vscode';
import { getXousCorePath, getDefaultBaud, getBuildTarget, getFlashLocation, getMonitorPort } from '@services/configService';

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
      'Welcome • Baochip',
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
          .update('baochip.showWelcomeOnStartup', msg.value, vscode.ConfigurationTarget.Global);
        return;
      }

      if (msg?.type === 'xousSite') {
        vscode.env.openExternal(vscode.Uri.parse('https://github.com/betrusted-io/xous-core'));
        return;
      }

      if (msg?.type === 'run') {
        switch (msg.cmd) {
          case 'configure':
            // Open Settings focused on Baochip
            vscode.commands.executeCommand('workbench.action.openSettings', 'Baochip');
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
      monitorPort: getMonitorPort(),
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
        <title>Welcome • Baochip</title>
      </head>
      <body>
        <div class="wrap">
          <header>
            <img src="${logoUri}" alt="Baochip logo" />
            <div class="stack">
              <h1>Welcome to Baochip</h1>
              <p class="muted">Quick actions to get you started.</p>
              <div class="toolbar">
                <div class="opts">
                  <label>
                    <input id="chk-startup" type="checkbox" checked />
                    Show Welcome on extension startup
                  </label>
                </div>

                <div class="spacer"></div>   <!-- NEW: occupies middle column -->

                <div class="links">
                  <a class="link" href="javascript:void(0)" id="btn-xousSite" title="Open xous-core on GitHub">
                    <span class="icon codicon codicon-github-inverted"></span>
                    betrusted-io/xous-core
                  </a>
                </div>
              </div>
            </div>
          </header>

          <!-- Three primary actions -->
          <div class="grid">
            <button id="btn-configure" class="btn">
              <span class="icon codicon codicon-gear"></span>
              <div class="title">Configure extension</div>
              <div class="subtitle">Paths, ports, defaults</div>
            </button>

            <button id="btn-createApp" class="btn">
              <span class="icon codicon codicon-add"></span>
              <div class="title">Create new app</div>
              <div class="subtitle">Scaffold in apps-dabao/</div>
            </button>

            <button id="btn-selectApp" class="btn">
              <span class="icon codicon codicon-folder"></span>
              <div class="title">Select app</div>
              <div class="subtitle">Choose from apps-dabao/</div>
            </button>
          </div>

        <script src="${jsUri}"></script>
      </body>
      </html>`;
  }
}
