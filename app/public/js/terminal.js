'use strict';
// Terminal tabs (xterm.js <-> WebSocket <-> PTY on the server)
D.terms = []; D.curTerm = null; D.runTerm = null;

const TERM_THEMES = {
  dark: { background: '#1c1c1e', foreground: '#e6edf3', cursor: '#58a6ff', selectionBackground: '#1f6feb66', black: '#484f58', red: '#ff7b72', green: '#3fb950', yellow: '#d29922', blue: '#58a6ff', magenta: '#bc8cff', cyan: '#39c5cf', white: '#b1bac4' },
  light: { background: '#ffffff', foreground: '#1f2328', cursor: '#0969da', selectionBackground: '#0969da33', black: '#24292f', red: '#cf222e', green: '#1a7f37', yellow: '#9a6700', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781' },
};
const themeKey = () => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
D.termTheme = () => D.terms.forEach((t) => { t.xt.options.theme = TERM_THEMES[themeKey()]; t.xt.options.fontSize = D.settings.termFontSize; });

D.newTerminal = (opts = {}) => {
  const cwd = opts.cwd || D.cwd || D.info.home;
  const xt = new Terminal({ fontFamily: D.settings.fontFamily, fontSize: D.settings.termFontSize, cursorBlink: true, scrollback: 10000, allowProposedApi: true, theme: TERM_THEMES[themeKey()] });
  const fit = new FitAddon.FitAddon(); xt.loadAddon(fit);
  xt.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => { if (e.ctrlKey || e.metaKey) { D.preview(uri); } }));
  const el = h('div', { class: 'term' }); $('#termHost').append(el);
  const t = { xt, fit, el, name: opts.name || 'Terminal ' + (D.terms.length + 1), ws: null, cwd };
  xt.open(el);
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const connect = () => {
    fit.fit();
    const ws = t.ws = new WebSocket(`${proto}://${location.host}/ws/term?cwd=${encodeURIComponent(cwd)}&cols=${xt.cols}&rows=${xt.rows}`);
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (e) => xt.write(typeof e.data === 'string' ? e.data : new Uint8Array(e.data));
    ws.onopen = () => { if (opts.cmd) setTimeout(() => ws.send(JSON.stringify({ t: 'i', d: opts.cmd + '\n' })), 250); };
    ws.onclose = () => { t.dead = true; };
  };
  xt.onData((d) => t.ws && t.ws.readyState === 1 && t.ws.send(JSON.stringify({ t: 'i', d })));
  xt.onResize(({ cols, rows }) => t.ws && t.ws.readyState === 1 && t.ws.send(JSON.stringify({ t: 'r', c: cols, r: rows })));
  xt.attachCustomKeyEventHandler((e) => {
    if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.key === 'C') { navigator.clipboard.writeText(xt.getSelection()); return false; }
    if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.key === 'V') { navigator.clipboard.readText().then((s) => xt.paste(s)); return false; }
    return true;
  });
  new ResizeObserver(() => { if (!el.classList.contains('hide')) try { fit.fit(); } catch (_) { /* hidden */ } }).observe(el);
  D.terms.push(t); D.showTerm(t); connect();
  return t;
};

D.showTerm = (t) => {
  D.curTerm = t; showPanel('term');
  D.terms.forEach((x) => x.el.classList.toggle('hide', x !== t));
  renderTermTabs(); requestAnimationFrame(() => { try { t.fit.fit(); } catch (_) { /* */ } t.xt.focus(); });
};

D.closeTerm = (t) => {
  if (t.ws) t.ws.close(); t.xt.dispose(); t.el.remove();
  D.terms = D.terms.filter((x) => x !== t); if (D.runTerm === t) D.runTerm = null;
  if (D.terms.length) D.showTerm(D.terms[D.terms.length - 1]); else { D.curTerm = null; renderTermTabs(); }
};

function renderTermTabs() {
  const box = $('#termTabs'); box.innerHTML = '';
  D.terms.forEach((t) => box.append(h('div', { class: 'tt' + (t === D.curTerm && panelMode === 'term' ? ' active' : ''), onclick: () => D.showTerm(t) },
    h('span', {}, '▸ ' + t.name), h('span', { class: 'x', onclick: (e) => { e.stopPropagation(); D.closeTerm(t); } }, '✕'))));
}

let panelMode = 'term';
function showPanel(mode) {
  panelMode = mode; $('#panel').classList.remove('min');
  $('#termHost').hidden = mode !== 'term'; $('#problems').hidden = mode !== 'problems';
  $$('.ptab').forEach((b) => b.classList.toggle('active', b.dataset.ptab === mode)); renderTermTabs();
}
window.showPanel = showPanel;

D.runInTerminal = (cmd, cwd) => {
  const line = `clear; cd ${shq(cwd)} && ${cmd}`;
  if (D.runTerm && !D.runTerm.dead) { D.showTerm(D.runTerm); D.runTerm.ws.send(JSON.stringify({ t: 'i', d: '\x03' + line + '\n' })); }
  else D.runTerm = D.newTerminal({ name: 'Run', cwd, cmd: line });
};
