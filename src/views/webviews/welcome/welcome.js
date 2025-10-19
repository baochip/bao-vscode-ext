(function () {
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);

  const actions = {
    configure: () => vscode.postMessage({ type: 'run', cmd: 'configure' }),
    selectApp: () => vscode.postMessage({ type: 'run', cmd: 'selectApp' }),
    createApp: () => vscode.postMessage({ type: 'run', cmd: 'createApp' }),
    examples: () => vscode.postMessage({ type: 'run', cmd: 'examples' }),
    xousSite: () => vscode.postMessage({ type: 'xousSite' }),
    toggleStartup: (checked) => vscode.postMessage({ type: 'setShowOnStartup', value: checked }),
  };

  ['configure', 'xousSite', 'selectApp', 'createApp'].forEach(id => {
    const el = byId('btn-' + id);
    if (el) el.addEventListener('click', actions[id]);
  });

  const chk = byId('chk-startup');
  if (chk) chk.addEventListener('change', () => actions.toggleStartup(chk.checked));

  // init state from extension
  window.addEventListener('message', (event) => {
    const { type, state } = event.data || {};
    if (type !== 'init') return;
    if (chk) chk.checked = !!state.showOnStartup;
  });
})();
