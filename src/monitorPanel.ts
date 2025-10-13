import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, spawn } from 'child_process';

export class MonitorPanel {
  public static current: MonitorPanel | undefined;
  private panel: vscode.WebviewPanel;
  private process: ChildProcessWithoutNullStreams | undefined;
  private disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext, opts: {
    pythonCmd: string;
    baoPath: string;
    port: string;
    baud: number;
  }) {
    if (MonitorPanel.current) {
      MonitorPanel.current.panel.reveal(vscode.ViewColumn.Active);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'baoMonitor',
      `Bao Monitor (${opts.port})`,
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    MonitorPanel.current = new MonitorPanel(panel, context, opts);
  }

  private constructor(panel: vscode.WebviewPanel, _ctx: vscode.ExtensionContext, opts: {
    pythonCmd: string; baoPath: string; port: string; baud: number;
  }) {
    this.panel = panel;
    this.panel.webview.html = this.getHtml();

    this.panel.webview.postMessage({ type: 'header', header: `${opts.port} @ ${opts.baud}` });
    this.panel.webview.postMessage({ type: 'init', baud: opts.baud });

    // Spawn monitor process
    const args = [opts.baoPath, 'monitor', '-p', opts.port, '-b', String(opts.baud), '--ts'];
    const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    this.process = spawn(opts.pythonCmd, args, { env });

    const post = (type: string, text: string) => {
      this.panel.webview.postMessage({ type, text });
    };

    this.process.stdout.on('data', (d) => post('out', d.toString()));
    this.process.stderr.on('data', (d) => post('err', d.toString()));
    this.process.on('close', (code, signal) => {
        const msg = code === null ? `[bao] monitor terminated${signal ? ` by ${signal}` : ''}` : `[bao] monitor exited (${code})`;
        this.panel.webview.postMessage({ type: 'status', text: `\n${msg}\n` });
    });


    // Messages from webview (clear, copy, stop)
    this.panel.webview.onDidReceiveMessage(msg => {
      if (msg?.type === 'stop') {
        this.dispose();
      } else if (msg?.type === 'clear') {
        this.panel.webview.postMessage({ type: 'clear' });
      } else if (msg?.type === 'change-baud' && typeof msg.baud === 'number') {
        const newBaud = msg.baud;
        try { if (this.process && !this.process.killed) this.process.kill(); } catch {}
        this.panel.webview.postMessage({ type:'status', text:`\n[bao] restarting at ${newBaud}...\n` });

        // re-spawn the monitor with the new baud
        const args = [opts.baoPath, 'monitor', '-p', opts.port, '-b', String(newBaud), '--ts'];
        this.process = spawn(opts.pythonCmd, args, { env });
        this.process.stdout.on('data', d => this.panel.webview.postMessage({ type:'out', text: d.toString() }));
        this.process.stderr.on('data', d => this.panel.webview.postMessage({ type:'err', text: d.toString() }));
        this.process.on('close', code => this.panel.webview.postMessage({ type:'status', text:`\n[bao] monitor exited (${code})` }));

        this.panel.webview.postMessage({ type:'header', header: `${opts.port} @ ${newBaud}` });
       } else if (msg?.type === 'save' && typeof msg.text === 'string') {
        vscode.window.showSaveDialog({
            title: 'Save monitor log',
            filters: { 'Text Files': ['txt'], 'All Files': ['*'] }
        }).then(uri => {
            if (!uri) return;
            const fs = require('fs');
            fs.writeFile(uri.fsPath, msg.text, 'utf8', (err: any) => {
            if (err) vscode.window.showErrorMessage(`Save failed: ${err.message || err}`);
            else vscode.window.showInformationMessage(`Saved log to ${uri.fsPath}`);
            });
        });
      }
    }, null, this.disposables);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private getHtml(): string {
    const css = `
        body { font-family: var(--vscode-font-family); margin:0; }
        #bar { display:flex; gap:8px; align-items:center; padding:8px; border-bottom:1px solid var(--vscode-editorGroup-border); }
        #spacer { flex:1; }
        #out {
        white-space: pre;
        padding: 8px;
        font-family: var(--vscode-editor-font-family, monospace);
        overflow:auto;
        height: calc(100vh - 48px);
        }
        #out.wrap { white-space: pre-wrap; }
        .err { opacity: 0.8; }
        .muted { opacity: 0.7; }
    `;
    const js = `
        const vscodeApi = acquireVsCodeApi();
        const out = document.getElementById('out');
        const btnStop = document.getElementById('stop');
        const btnClear = document.getElementById('clear');
        const btnCopy = document.getElementById('copy');
        const btnPause = document.getElementById('pause');
        const btnScroll = document.getElementById('scroll');
        const btnWrap = document.getElementById('wrap');
        const selBaud  = document.getElementById('baud'); 
        const btnSave  = document.getElementById('save');


        let paused = false;
        let autoscroll = true;
        let wrapped = false;

        const MAX_CHARS = 2 * 1024 * 1024; // ~2 MB of text

        function trimIfNeeded() {
        const t = out.textContent || '';
        if (t.length > MAX_CHARS) {
            // drop the oldest half to keep things responsive
            out.textContent = t.slice(t.length - (MAX_CHARS / 2));
        }
        }

        function append(text, cls='') {
        if (paused) return;
        const span = document.createElement('span');
        if (cls) span.className = cls;
        span.textContent = text;
        out.appendChild(span);
        trimIfNeeded();
        if (autoscroll) out.scrollTop = out.scrollHeight;
        }

        window.addEventListener('message', (event) => {
        const { type, text, header } = event.data;
        if (type === 'out') append(text);
        if (type === 'err') append(text, 'err');
        if (type === 'status') append(text, 'muted');
        if (type === 'clear') out.textContent = '';
        if (type === 'header') document.getElementById('hdr').textContent = header;
        if (type === 'init' && baud) {
            // set dropdown to current baud on first load
            const opt = Array.from(selBaud.options).find(o => o.value === String(baud));
            if (opt) selBaud.value = String(baud);
        }
        });

        selBaud.onchange = () => {
            const value = parseInt(selBaud.value, 10) || 115200;
            vscodeApi.postMessage({ type: 'change-baud', baud: value });
        };

        btnStop.onclick = () => vscodeApi.postMessage({ type:'stop' });
        btnClear.onclick = () => { out.textContent = ''; };
        btnCopy.onclick = async () => {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(out); sel.removeAllRanges(); sel.addRange(range);
        document.execCommand('copy'); sel.removeAllRanges();
        };
        btnPause.onclick = () => {
        paused = !paused;
        btnPause.textContent = paused ? 'Resume' : 'Pause';
        };
        btnScroll.onclick = () => {
        autoscroll = !autoscroll;
        btnScroll.textContent = autoscroll ? 'Autoscroll: On' : 'Autoscroll: Off';
        };
        btnWrap.onclick = () => {
        wrapped = !wrapped;
        out.classList.toggle('wrap', wrapped);
        btnWrap.textContent = wrapped ? 'Wrap: On' : 'Wrap: Off';
        };
        btnSave.onclick = () => {
        const text = out.textContent || '';
        vscodeApi.postMessage({ type: 'save', text });
        };
    `;
    return `
        <!doctype html>
        <html>
        <head><meta charset="utf-8" /><style>${css}</style></head>
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
        <script>${js}</script>
        </body>
        </html>
    `;
    }


  dispose() {
    if (this.process && !this.process.killed) {
      try { this.process.kill(); } catch {}
    }
    this.disposables.forEach(d => d.dispose());
    try { this.panel.dispose(); } catch {}
    MonitorPanel.current = undefined;
  }
}
