'use strict';
// Monaco editor: colours, tabs, autosave, live "red underline" checking
D.tabs = []; D.active = null; D.monaco = null; D.editor = null;

const THEMES = {
  'devos-dark': { base: 'vs-dark', colors: { 'editor.background': '#1c1c1e', 'editor.lineHighlightBackground': '#242426', 'editorLineNumber.foreground': '#636366', 'editorGutter.background': '#1c1c1e' },
    rules: [['comment', '8b949e', 'italic'], ['keyword', 'ff7b72'], ['keyword.control', 'ff7b72'], ['string', 'a5d6ff'], ['number', '79c0ff'], ['regexp', '7ee787'], ['type', 'ffa657'], ['type.identifier', 'ffa657'],
      ['identifier', 'e6edf3'], ['function', 'd2a8ff'], ['delimiter', 'c9d1d9'], ['tag', '7ee787'], ['attribute.name', '79c0ff'], ['attribute.value', 'a5d6ff'], ['constant', '79c0ff'], ['variable', 'ffa657'], ['predefined', 'd2a8ff'], ['metatag', 'ff7b72']] },
  'devos-light': { base: 'vs', colors: { 'editor.background': '#ffffff' },
    rules: [['comment', '6e7781', 'italic'], ['keyword', 'cf222e'], ['string', '0a3069'], ['number', '0550ae'], ['type', '953800'], ['tag', '116329'], ['attribute.name', '0550ae'], ['function', '8250df']] },
  'devos-hc': { base: 'hc-black', colors: {}, rules: [] },
};

function monacoLang(path) { const l = langByExt(path); return l ? l.monaco : 'plaintext'; }

D.initEditor = () => new Promise((resolve) => {
  require.config({ paths: { vs: '/vendor/monaco/vs' } });
  window.MonacoEnvironment = { getWorkerUrl: () => '/js/monaco-worker.js' };
  require(['vs/editor/editor.main'], () => {
    const m = D.monaco = window.monaco;
    for (const [name, t] of Object.entries(THEMES)) {
      m.editor.defineTheme(name, { base: t.base, inherit: true, colors: t.colors, rules: t.rules.map(([token, fg, fs]) => ({ token, foreground: fg, fontStyle: fs || '' })) });
    }
    m.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });
    m.languages.typescript.javascriptDefaults.setCompilerOptions({ target: m.languages.typescript.ScriptTarget.ES2022, allowNonTsExtensions: true, allowJs: true, checkJs: false });
    m.languages.typescript.typescriptDefaults.setCompilerOptions({ target: m.languages.typescript.ScriptTarget.ES2022, allowNonTsExtensions: true, module: m.languages.typescript.ModuleKind.CommonJS, lib: ['es2022', 'dom'] });
    m.languages.typescript.typescriptDefaults.addExtraLib('declare var process:any; declare var require:any; declare var module:any; declare var exports:any; declare var __dirname:string; declare var __filename:string; declare var Buffer:any;', 'node-lite.d.ts');
    D.editor = m.editor.create($('#editor'), { model: null, automaticLayout: true, theme: D.resolveTheme(), fontSize: D.settings.fontSize, bracketPairColorization: { enabled: true },
      smoothScrolling: true, cursorSmoothCaretAnimation: 'on', renderWhitespace: 'selection', scrollBeyondLastLine: false, guides: { indentation: true }, fixedOverflowWidgets: true });
    D.editor.onDidChangeCursorPosition((e) => ($('#stPos').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`));
    D.editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => D.save());
    D.editor.addCommand(m.KeyCode.F5, () => D.run());
    D.editor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => D.run());
    m.editor.onDidChangeMarkers(updateProblems);
    D.applySettings();
    resolve();
  });
});

D.applySettings = () => {
  const s = D.settings; document.documentElement.dataset.theme = D.themeAttr();
  if (!D.editor) return;
  D.monaco.editor.setTheme(D.resolveTheme());
  D.editor.updateOptions({ fontSize: s.fontSize, fontFamily: s.fontFamily, fontLigatures: s.ligatures, tabSize: s.tabSize, insertSpaces: s.insertSpaces,
    wordWrap: s.wordWrap, minimap: { enabled: s.minimap }, lineNumbers: s.lineNumbers });
  D.tabs.forEach((t) => t.model.updateOptions({ tabSize: s.tabSize, insertSpaces: s.insertSpaces }));
  D.termTheme && D.termTheme();
  document.documentElement.style.setProperty('--sw', s.sidebarWidth + 'px');
};

function renderTabs() {
  const bar = $('#tabs'); bar.innerHTML = '';
  D.tabs.forEach((t) => bar.append(h('div', { class: 'tab' + (t === D.active ? ' active' : ''), title: t.path, onclick: () => D.activate(t), onauxclick: (e) => e.button === 1 && D.closeTab(t) },
    h('span', {}, base(t.path)), h('span', { class: 'dot' }, t.dirty ? '●' : ''), h('span', { class: 'x', onclick: (e) => { e.stopPropagation(); D.closeTab(t); } }, '✕'))));
  $('#welcome').hidden = D.tabs.length > 0;
}

D.activate = (t) => {
  D.active = t; showPage(null);
  D.editor.setModel(t ? t.model : null); renderTabs();
  const l = t && langByExt(t.path); $('#stLang').textContent = l ? l.name : '';
  if (t) { D.editor.focus(); scheduleCheck(t); updateRunLang(); }
  updateProblems(); localStorage.setItem('devos.last', JSON.stringify(D.tabs.map((x) => x.path)));
};

D.openFile = async (path, line) => {
  let t = D.tabs.find((x) => x.path === path);
  if (!t) {
    let r; try { r = await GET('/api/fs/read?path=' + encodeURIComponent(path)); } catch (e) { return fail(e); }
    if (r.binary) { const ok = await confirmBox('Binary file', base(path) + ' is a binary file (' + human(r.size) + '). Download it instead?'); if (ok) location.href = '/api/fs/download?path=' + encodeURIComponent(path); return; }
    const model = D.monaco.editor.createModel(r.content, monacoLang(path), D.monaco.Uri.file(path));
    model.updateOptions({ tabSize: D.settings.tabSize, insertSpaces: D.settings.insertSpaces });
    t = { path, model, dirty: false, saved: r.content, timer: null };
    model.onDidChangeContent(() => {
      t.dirty = model.getValue() !== t.saved; renderTabs(); scheduleCheck(t);
      clearTimeout(t.timer);
      if (t.dirty && D.settings.autosave === 'afterDelay') t.timer = setTimeout(() => D.save(t), D.settings.autosaveDelay);
    });
    D.tabs.push(t);
  }
  D.activate(t);
  if (line) { D.editor.revealLineInCenter(line); D.editor.setPosition({ lineNumber: line, column: 1 }); }
};

D.save = async (t = D.active) => {
  if (!t) return;
  try {
    if (D.settings.formatOnSave && D.editor && t === D.active) await D.editor.getAction('editor.action.formatDocument')?.run();
    const content = t.model.getValue();
    await PUT('/api/fs/write', { path: t.path, content });
    t.saved = content; t.dirty = false; renderTabs();
    $('#stSave').textContent = 'saved ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    if (!$('#previewWrap').hidden && D.previewPath) D.reloadPreview();
  } catch (e) { fail(e); }
};
D.saveAll = () => Promise.all(D.tabs.filter((t) => t.dirty).map((t) => D.save(t)));

D.closeTab = async (t) => {
  if (t.dirty && !(await confirmBox('Unsaved changes', base(t.path) + ' has unsaved changes. Close without saving?', true))) return;
  const i = D.tabs.indexOf(t); D.tabs.splice(i, 1); t.model.dispose();
  D.activate(D.tabs[Math.min(i, D.tabs.length - 1)] || null);
};

D.onRename = (from, to) => D.tabs.forEach((t) => { if (t.path === from || t.path.startsWith(from + '/')) { t.path = to + t.path.slice(from.length); } }) || renderTabs();
D.onDeleted = (p) => D.tabs.filter((t) => t.path === p || t.path.startsWith(p + '/')).forEach((t) => { t.dirty = false; D.closeTab(t); });

// ---- live checker -----------------------------------------------------------------------
const SEV = () => D.monaco.MarkerSeverity;
function scheduleCheck(t) {
  if (!D.settings.checkOnType) return;
  clearTimeout(t.checkTimer); t.checkTimer = setTimeout(() => runCheck(t), D.settings.checkDelay);
}
async function runCheck(t) {
  const lang = langByExt(t.path); if (!lang || !lang.hasChecker || lang.monacoChecks) { setCheckStatus(t, lang); return; }
  const code = t.model.getValue(); const ver = t.model.getVersionId();
  try {
    const r = await POST('/api/check', { lang: lang.id, code, path: t.path });
    if (t.model.isDisposed() || t.model.getVersionId() !== ver) return;
    if (r.unavailable) { D.monaco.editor.setModelMarkers(t.model, 'devos-check', []); t.checkInfo = `no checker: install "${r.unavailable}"`; return setCheckStatus(t, lang); }
    const markers = r.markers.map((m) => {
      const line = Math.min(m.line, t.model.getLineCount()); const w = t.model.getWordAtPosition({ lineNumber: line, column: m.col });
      const endCol = w ? w.endColumn : Math.min(m.col + 1, t.model.getLineMaxColumn(line));
      return { severity: m.severity === 'warning' ? SEV().Warning : SEV().Error, message: m.message, startLineNumber: line, startColumn: w ? w.startColumn : m.col,
        endLineNumber: line, endColumn: Math.max(endCol, m.col + 1), source: lang.id };
    });
    D.monaco.editor.setModelMarkers(t.model, 'devos-check', markers);
    t.checkInfo = ''; setCheckStatus(t, lang);
  } catch (_) { /* offline / server busy */ }
}
function setCheckStatus(t, lang) {
  if (t !== D.active) return;
  const ms = D.monaco.editor.getModelMarkers({ resource: t.model.uri });
  const e = ms.filter((m) => m.severity === SEV().Error).length, w = ms.filter((m) => m.severity === SEV().Warning).length;
  $('#stCheck').innerHTML = t.checkInfo ? `<span class="warn">${esc(t.checkInfo)}</span>` : (e || w) ? `✖ ${e}  ⚠ ${w}` : (lang && lang.hasChecker ? '✔ no problems' : '');
}
function updateProblems() {
  if (!D.monaco) return;
  const ms = D.monaco.editor.getModelMarkers({}).filter((m) => m.severity >= SEV().Warning).sort((a, b) => b.severity - a.severity);
  $('#problemCount').textContent = ms.length; $('#problemCount').style.display = ms.length ? '' : 'none';
  const box = $('#problems'); box.innerHTML = '';
  if (!ms.length) box.append(h('div', { class: 'pr muted' }, 'No problems detected.'));
  ms.slice(0, 500).forEach((m) => box.append(h('div', { class: 'pr', onclick: () => D.openFile(m.resource.path, m.startLineNumber) },
    h('span', { class: m.severity === SEV().Error ? 'bad' : 'warn' }, m.severity === SEV().Error ? '✖' : '⚠'), h('span', {}, m.message), h('span', { class: 'loc' }, `${base(m.resource.path)}:${m.startLineNumber}:${m.startColumn}`))));
  if (D.active) setCheckStatus(D.active, langByExt(D.active.path));
}

// ---- run --------------------------------------------------------------------------------
function updateRunLang() {
  const sel = $('#runLang'); const t = D.active; if (!t) { sel.hidden = true; return; }
  const cur = langByExt(t.path); const runners = D.langs.filter((l) => l.run && !l.run.startsWith('@'));
  sel.innerHTML = ''; sel.append(h('option', { value: '' }, 'Run as: auto (' + (cur ? cur.name : '?') + ')'));
  runners.forEach((l) => sel.append(h('option', { value: l.id }, l.name)));
  sel.hidden = false; sel.value = t.runAs || '';
}
D.runCommand = (t) => {
  const lang = t.runAs ? D.langs.find((l) => l.id === t.runAs) : langByExt(t.path);
  const ext = base(t.path).split('.').pop();
  let tpl = (D.settings.runners || {})[lang && lang.id] || (D.settings.runners || {})['.' + ext] || (lang && lang.run);
  if (!tpl) return null;
  if (tpl.startsWith('@')) return tpl;
  const name = base(t.path).replace(/\.[^.]*$/, '');
  return tpl.replaceAll('{file}', shq(t.path)).replaceAll('{dir}', shq(dirOf(t.path))).replaceAll('{base}', shq(base(t.path))).replaceAll('{name}', name.replace(/[^\w.-]/g, '_'));
};
D.run = async () => {
  const t = D.active; if (!t) return toast('Open a file first');
  await D.save(t);
  const proj = await GET('/api/project?path=' + encodeURIComponent(t.path)).catch(() => ({}));
  let cmd = D.runCommand(t), cwd = dirOf(t.path);
  if (proj.run && !t.runAs && !(D.settings.runners || {})[(langByExt(t.path) || {}).id]) { cmd = proj.run; cwd = proj.dir; }
  if (!cmd) return toast('No run command for this file type. Add one in Custom Maker → Run profiles.', 'err', 6000);
  if (cmd.startsWith('@preview')) { const target = cmd.split(' ')[1]; return D.openInBrowser(target ? join(cwd, target) : t.path); }
  D.runInTerminal(cmd, cwd);
};
