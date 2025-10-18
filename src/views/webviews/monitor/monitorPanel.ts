import * as vscode from 'vscode';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';

interface MonitorOpts {
  pythonCmd: string;
  baoPath: string;
  port: string;
  baud: number;
  cwd?: string;
}

export class MonitorPanel {
  public static current: MonitorPanel | undefined;
  private panel: vscode.WebviewPanel;
  private process: ChildProcessWithoutNullStreams | undefined;
  private disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext, opts: MonitorOpts) {
    if (MonitorPanel.current) {
      MonitorPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'baoMonitor',
      `Bao Monitor (${opts.port})`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'src', 'views', 'webviews', 'monitor'),
        ],
      }
    );
    MonitorPanel.current = new MonitorPanel(panel, context, opts);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly ctx: vscode.ExtensionContext,
    private readonly opts: MonitorOpts
  ) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();
    this.panel.webview.postMessage({ type: 'header', header: `${this.opts.port} @ ${this.opts.baud}` });
    this.panel.webview.postMessage({ type: 'init', baud: this.opts.baud });

    // start monitor
    this.spawnMonitor(this.opts.baud);

    // webview → extension messages
    this.panel.webview.onDidReceiveMessage(msg => this.onMessage(msg), null, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private spawnMonitor(baud: number) {
    const args = [this.opts.baoPath, 'monitor', '-p', this.opts.port, '-b', String(baud), '--ts'];
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };

    // kill previous
    try { if (this.process && !this.process.killed) this.process.kill(); } catch {}

    this.process = spawn(this.opts.pythonCmd, args, {
      env,
      cwd: this.opts.cwd, 
    });

    const post = (type: string, text: string) =>
      this.panel.webview.postMessage({ type, text });

    this.process.stdout.on('data', d => post('out', d.toString()));
    this.process.stderr.on('data', d => post('err', d.toString()));
    this.process.on('close', (code, signal) => {
      const msg = code === null
        ? `[bao] monitor terminated${signal ? ` by ${signal}` : ''}`
        : `[bao] monitor exited (${code})`;
      this.panel.webview.postMessage({ type: 'status', text: `\n${msg}\n` });
    });
  }

  private async onMessage(msg: any) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'stop') {
      this.dispose();
      return;
    }
    if (msg.type === 'clear') {
      this.panel.webview.postMessage({ type: 'clear' });
      return;
    }
    if (msg.type === 'change-baud' && typeof msg.baud === 'number') {
      const newBaud = msg.baud;
      this.panel.webview.postMessage({ type: 'status', text: `\n[bao] restarting at ${newBaud}...\n` });
      this.spawnMonitor(newBaud);
      this.panel.webview.postMessage({ type: 'header', header: `${this.opts.port} @ ${newBaud}` });
      return;
    }
    if (msg.type === 'save' && typeof msg.text === 'string') {
      const uri = await vscode.window.showSaveDialog({
        title: 'Save monitor log',
        filters: { 'Text Files': ['txt'], 'All Files': ['*'] }
      });
      if (!uri) return;
      try {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(msg.text, 'utf8'));
        vscode.window.showInformationMessage(`Saved log to ${uri.fsPath}`);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Save failed: ${e?.message || e}`);
      }
      return;
    }
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const csp = webview.cspSource;

    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, 'src', 'views', 'webviews', 'monitor', 'monitor.css')
    );
    const jsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, 'src', 'views', 'webviews', 'monitor', 'monitor.js')
    );

    return `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   style-src ${csp};
                   script-src ${csp};
                   font-src ${csp};
                   img-src ${csp} data:;">
        <link rel="stylesheet" href="${cssUri}">
        <title>Bao Monitor</title>
      </head>
      <body>
        <div id="bar">
          <strong id="hdr" class="muted"></strong>
          <label class="muted">Baud:</label>
          <select id="baud">
            <option>9600</option>
            <option>57600</option>
            <option selected>115200</option>
            <option>230400</option>
            <option>460800</option>
            <option>921600</option>
          </select>
          <span id="spacer"></span>
          <button id="pause">Pause</button>
          <button id="scroll">Autoscroll: On</button>
          <button id="wrap">Wrap: Off</button>
          <button id="clear">Clear</button>
          <button id="copy">Copy</button>
          <button id="save">Save</button>
          <button id="stop">Stop</button>
        </div>
        <div id="out"></div>
        <script src="${jsUri}"></script>
      </body>
      </html>
    `;
  }

  dispose() {
    try { if (this.process && !this.process.killed) this.process.kill(); } catch {}
    this.disposables.forEach(d => d.dispose());
    try { this.panel.dispose(); } catch {}
    MonitorPanel.current = undefined;
  }
}
