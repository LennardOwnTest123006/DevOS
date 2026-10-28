'use strict';
// Boot, menus, shortcuts, layout
function welcome() {
  const w = $('#welcome'); w.innerHTML = '';
  const b = (icon, t, d, fn) => h('button', { onclick: fn }, h('div', {}, icon + ' ' + t), h('small', { class: 'muted' }, d));
  w.append(h('h1', {}, h('span', { class: 'logo' }, '</>'), ' DevOS'), h('p', { class: 'muted' }, 'The operating system for developers. Pick something to start:'),
    h('div', { class: 'grid' },
      b('🛠️', 'New project', 'Web, Node, Python, C/C++, Java, Go, Rust …', () => D.page('maker')),
      b('📄', 'New file', 'Empty file in this folder', () => D.newFile()),
      b('⌨️', 'Terminal', 'Full shell (Ctrl+`)', () => D.newTerminal()),
      b('🧰', 'Languages & tools', 'What is installed', () => D.page('tools')),
      b('📶', 'Wi-Fi / LAN', 'Connect, share files', () => D.page('network')),
      b('💾', 'USB export', 'Copy projects to a stick', () => D.page('usb')),
      b('🌐', 'Browser', 'Open internet browser', () => $('#btnBrowser').click()),
      b('⚙️', 'Settings', 'Themes, fonts, editor', () => D.page('settings'))),
    h('p', { class: 'muted' }, 'Shortcuts: ', h('kbd', {}, 'F5'), ' run · ', h('kbd', {}, 'Ctrl+S'), ' save · ', h('kbd', {}, 'Ctrl+`'), ' terminal · ', h('kbd', {}, 'F1'), ' editor commands · ', h('kbd', {}, 'Ctrl+Shift+F'), ' search'));
}

function topMenus() {
  const defs = {
    file: () => [{ label: 'New file…', run: () => D.newFile(), key: '' }, { label: 'New project…', run: () => D.page('maker') }, { label: 'Save', run: () => D.save(), key: 'Ctrl+S' }, { label: 'Save all', run: () => D.saveAll() }, '-',
      { label: 'Open folder…', run: async () => { const p = await ask('Open folder (absolute path)', D.cwd); if (p) D.loadDir(p); } }, { label: 'Export current folder to USB…', run: () => D.page('usb', { src: D.cwd }) },
      { label: 'Download current file', run: () => D.active && (location.href = '/api/fs/download?path=' + encodeURIComponent(D.active.path)) }, '-', { label: 'Close tab', run: () => D.active && D.closeTab(D.active) }],
    run: () => [{ label: 'Run current file', run: () => D.run(), key: 'F5' }, { label: 'Open web preview', run: () => D.preview(D.active ? D.active.path : '') }, '-', { label: 'New terminal', run: () => D.newTerminal(), key: 'Ctrl+`' }, { label: 'Clear Run terminal', run: () => D.runTerm && D.runTerm.xt.clear() }],
    view: () => [{ label: 'Explorer', run: () => setView('files') }, { label: 'Search', run: () => setView('search') }, { label: 'Problems', run: () => showPanel('problems') }, { label: 'Toggle panel', run: () => togglePanel(), key: 'Ctrl+`' }, '-',
      ...[['devos-dark', 'Dark theme'], ['devos-light', 'Light theme'], ['devos-hc', 'High contrast']].map(([v, n]) => ({ label: n, run: () => { D.settings.theme = v; D.applySettings(); PUT('/api/settings', D.settings); } })),
      { label: 'Zoom in', run: () => { D.settings.fontSize++; D.applySettings(); } }, { label: 'Zoom out', run: () => { D.settings.fontSize--; D.applySettings(); } }],
    tools: () => [{ label: 'Custom Maker', run: () => D.page('maker') }, { label: 'Network & sharing', run: () => D.page('network') }, { label: 'USB & export', run: () => D.page('usb') }, { label: 'Languages & tools', run: () => D.page('tools') }, { label: 'Settings', run: () => D.page('settings') }],
  };
  $$('#menus button').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); const r = b.getBoundingClientRect(); menu(r.left, r.bottom + 2, defs[b.dataset.menu]()); }));
}

function setView(v) {
  $$('#sidebar section').forEach((s) => (s.hidden = s.id !== 'view-' + v));
  $$('#activity [data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'search') $('#searchQ').focus();
}
function togglePanel() { $('#panel').classList.toggle('min'); if (!$('#panel').classList.contains('min') && D.curTerm) D.showTerm(D.curTerm); }

function resizers() {
  const drag = (el, move) => el.addEventListener('mousedown', (e) => { e.preventDefault(); const mm = (ev) => move(ev); const up = () => { removeEventListener('mousemove', mm); removeEventListener('mouseup', up); saveLayout(); }; addEventListener('mousemove', mm); addEventListener('mouseup', up); });
  drag($('#resizerV'), (e) => { D.settings.sidebarWidth = Math.max(160, Math.min(600, e.clientX - 44)); document.documentElement.style.setProperty('--sw', D.settings.sidebarWidth + 'px'); });
  drag($('#resizerH'), (e) => { const h = Math.max(80, innerHeight - e.clientY - 24); D.settings.panelHeight = h; document.documentElement.style.setProperty('--ph', h + 'px'); if (D.curTerm) try { D.curTerm.fit.fit(); } catch (_) { /* */ } });
  document.documentElement.style.setProperty('--ph', D.settings.panelHeight + 'px');
}
const saveLayout = debounce(() => PUT('/api/settings', { sidebarWidth: D.settings.sidebarWidth, panelHeight: D.settings.panelHeight }).catch(() => {}), 500);

async function boot() {
  [D.settings, D.info, D.langs] = await Promise.all([GET('/api/settings'), GET('/api/info'), GET('/api/languages')]);
  document.documentElement.dataset.theme = D.themeAttr();
  registerCustom();
  $('#stHost').textContent = `${D.info.user}@${D.info.hostname} · DevOS ${D.info.version}`;
  if (D.info.live) $('#btnPower').hidden = false;
  await D.initEditor(); D.initFiles(); topMenus(); resizers(); welcome();
  $$('#activity [data-view]').forEach((b) => b.addEventListener('click', () => { showPage(null); setView(b.dataset.view); }));
  $$('#activity [data-page]').forEach((b) => b.addEventListener('click', () => ($('#pageWrap').hidden || !b.classList.contains('active') ? D.page(b.dataset.page) : showPage(null))));
  $$('.ptab').forEach((b) => b.addEventListener('click', () => showPanel(b.dataset.ptab)));
  $('#termNew').onclick = () => D.newTerminal(); $('#panelToggle').onclick = togglePanel;
  $('#btnRun').onclick = () => D.run(); $('#btnPower').onclick = () => D.page('settings');
  $('#btnPreview').onclick = () => { const w = $('#previewWrap'); w.hidden ? D.preview(D.active && /\.(html?|md)$/i.test(D.active.path) ? D.active.path : '') : (w.hidden = true); };
  $('#pvClose').onclick = () => ($('#previewWrap').hidden = true); $('#pvReload').onclick = () => D.reloadPreview();
  $('#pvBack').onclick = () => { try { $('#pvFrame').contentWindow.history.back(); } catch (_) { /* cross-origin */ } };
  $('#pvFwd').onclick = () => { try { $('#pvFrame').contentWindow.history.forward(); } catch (_) { /* cross-origin */ } };
  $('#pvUrl').onkeydown = (e) => { if (e.key === 'Enter') { let v = e.target.value.trim(); if (/^(localhost|127\.|\d+\.\d+\.\d+\.\d+)/.test(v)) v = 'http://' + v; D.preview(v); } };
  $('#pvOpen').onclick = () => { const v = $('#pvUrl').value; if (/^https?:/.test(v)) POST('/api/browser/open', { url: v }).catch(() => window.open(v, '_blank')); };
  $('#btnBrowser').onclick = () => POST('/api/browser/open', { url: 'https://duckduckgo.com/' }).catch(() => { window.open('https://duckduckgo.com/', '_blank'); });
  $('#runLang').onchange = (e) => { if (D.active) D.active.runAs = e.target.value; };
  addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === '`') { e.preventDefault(); togglePanel(); }
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); showPage(null); setView('search'); }
    else if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'e') { e.preventDefault(); showPage(null); setView('files'); }
    else if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); D.save(); }
    else if (e.key === 'F5' && !D.editor.hasTextFocus()) { e.preventDefault(); D.run(); }
  });
  addEventListener('beforeunload', (e) => { if (D.tabs.some((t) => t.dirty)) { e.preventDefault(); e.returnValue = ''; } });
  showPanel('term'); D.newTerminal({ cwd: D.settings.home });
  await D.loadDir(localStorage.getItem('devos.cwd') || D.settings.home || D.info.home).catch(() => D.loadDir(D.info.home));
  try { for (const p of JSON.parse(localStorage.getItem('devos.last') || '[]')) await D.openFile(p); } catch (_) { /* nothing to restore */ }
  if (!D.tabs.length) renderWelcomeTabs();
}
function renderWelcomeTabs() { $('#welcome').hidden = false; }
boot().catch((e) => { document.body.innerHTML = '<pre style="padding:20px;color:#f85149">DevOS failed to start: ' + esc(e.message) + '</pre>'; });
