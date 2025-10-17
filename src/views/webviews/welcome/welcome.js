(function () {
  const vscode = acquireVsCodeApi();
  const byId = (id) => document.getElementById(id);

  const actions = {
    configure: () => vscode.postMessage({ type: 'run', cmd: 'configure' }),
    newProject: () => vscode.postMessage({ type: 'run', cmd: 'newProject' }),
    examples: () => vscode.postMessage({ type: 'run', cmd: 'examples' }),
    devkit: () => vscode.postMessage({ type: 'openDevkit' }),
    toggleStartup: (checked) => vscode.postMessage({ type: 'setShowOnStartup', value: checked }),
  };

  ['configure','newProject','examples','devkit'].forEach(id => {
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
