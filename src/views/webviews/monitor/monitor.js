(function () {
  const vscode = acquireVsCodeApi();

  const out      = document.getElementById('out');
  const btnStop  = document.getElementById('stop');
  const btnClear = document.getElementById('clear');
  const btnCopy  = document.getElementById('copy');
  const btnPause = document.getElementById('pause');
  const btnScroll= document.getElementById('scroll');
  const btnWrap  = document.getElementById('wrap');
  const btnSave  = document.getElementById('save');
  const selBaud  = document.getElementById('baud');

  let paused = false;
  let autoscroll = true;
  let wrapped = false;
  let initialBaud = null;

  const MAX_CHARS = 2 * 1024 * 1024; // ~2MB

  function trimIfNeeded() {
    const t = out.textContent || '';
    if (t.length > MAX_CHARS) {
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
    const { type, text, header, baud } = event.data || {};
    if (type === 'out') append(text);
    if (type === 'err') append(text, 'err');
    if (type === 'status') append(text, 'muted');
    if (type === 'clear') out.textContent = '';
    if (type === 'header') document.getElementById('hdr').textContent = header;
    if (type === 'init') {
      initialBaud = baud;
      const opt = Array.from(selBaud.options).find(o => o.value === String(baud));
      if (opt) selBaud.value = String(baud);
    }
  });

  selBaud.addEventListener('change', () => {
    const value = parseInt(selBaud.value, 10) || (initialBaud || 115200);
    vscode.postMessage({ type: 'change-baud', baud: value });
  });

  btnStop .addEventListener('click', () => vscode.postMessage({ type:'stop' }));
  btnClear.addEventListener('click', () => { out.textContent = ''; });
  btnCopy .addEventListener('click', () => {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(out);
    sel.removeAllRanges(); sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
  });
  btnPause.addEventListener('click', () => {
    paused = !paused;
    btnPause.textContent = paused ? 'Resume' : 'Pause';
  });
  btnScroll.addEventListener('click', () => {
    autoscroll = !autoscroll;
    btnScroll.textContent = autoscroll ? 'Autoscroll: On' : 'Autoscroll: Off';
  });
  btnWrap.addEventListener('click', () => {
    wrapped = !wrapped;
    out.classList.toggle('wrap', wrapped);
    btnWrap.textContent = wrapped ? 'Wrap: On' : 'Wrap: Off';
  });
  btnSave.addEventListener('click', () => {
    const text = out.textContent || '';
    vscode.postMessage({ type: 'save', text });
  });
})();
