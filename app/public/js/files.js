'use strict';
// Explorer: lazy tree, context menu, drag & drop upload, search
D.expanded = new Set(); let selected = null;

D.loadDir = async (path) => {
  D.cwd = path; localStorage.setItem('devos.cwd', path);
  $('#crumb').textContent = path; $('#crumb').title = path;
  await renderTree();
};

async function renderTree() {
  const tree = $('#tree'); const scroll = tree.scrollTop; tree.innerHTML = '';
  try { await renderLevel(tree, D.cwd, 0); } catch (e) { fail(e); }
  tree.scrollTop = scroll;
}

async function renderLevel(parent, dir, depth) {
  const r = await GET('/api/fs/list?path=' + encodeURIComponent(dir));
  for (const e of r.entries) {
    const p = join(dir, e.name);
    const row = h('div', { class: 'row' + (p === selected ? ' sel' : ''), style: `padding-left:${8 + depth * 14}px`, 'data-path': p, 'data-dir': e.dir ? '1' : '',
      onclick: async (ev) => {
        selected = p; $$('.row.sel').forEach((x) => x.classList.remove('sel')); row.classList.add('sel');
        if (e.dir) { D.expanded.has(p) ? D.expanded.delete(p) : D.expanded.add(p); renderTree(); } else D.openFile(p);
      },
      ondblclick: (ev) => { if (e.dir && ev.ctrlKey) D.loadDir(p); },
      oncontextmenu: (ev) => { ev.preventDefault(); selected = p; fileMenu(ev.clientX, ev.clientY, p, e.dir); } },
      h('span', { class: 'arrow' }, e.dir ? (D.expanded.has(p) ? '▾' : '▸') : ''), svgIcon(e.dir), h('span', { class: 'nm' }, e.name));
    parent.append(row);
    if (e.dir && D.expanded.has(p)) await renderLevel(parent, p, depth + 1).catch(() => {});
  }
  if (!r.entries.length && depth === 0) parent.append(h('div', { class: 'muted', style: 'padding:8px' }, 'Empty folder. Right-click → New file.'));
}

const svgIcon = (dir) => { const sp = h('span'); sp.innerHTML = dir ? '<svg class="ic dir" viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>' : '<svg class="ic" viewBox="0 0 24 24"><path d="M6 3h8l5 5v13H6zM14 3v5h5"/></svg>'; return sp; };
const ICONS = { js: '🟨', ts: '🔷', py: '🐍', c: '🇨', cpp: '➕', java: 'J', go: '🐹', rs: '🦀', html: '🌐', css: '🎨', json: '🧾', md: '📝', sh: '💲', php: '🐘', rb: '💎', lua: '🌙' };
const fileIcon = (n) => ICONS[n.split('.').pop().toLowerCase()] || '📄';

function fileMenu(x, y, p, isDir) {
  const dir = isDir ? p : dirOf(p);
  menu(x, y, [
    { label: 'New file…', run: () => newFile(dir) }, { label: 'New folder…', run: () => newDir(dir) }, '-',
    isDir ? { label: 'Open as workspace root', run: () => D.loadDir(p) } : { label: 'Open', run: () => D.openFile(p) },
    { label: 'Open terminal here', run: () => D.newTerminal({ cwd: dir, name: base(dir) }) },
    { label: 'Rename…', run: async () => { const n = await ask('Rename', base(p)); if (n && n !== base(p)) { await POST('/api/fs/rename', { from: p, to: join(dirOf(p), n) }).catch(fail); D.onRename(p, join(dirOf(p), n)); renderTree(); } } },
    { label: 'Duplicate', run: async () => { await POST('/api/fs/copy', { from: p, to: p + '-copy' }).catch(fail); renderTree(); } },
    { label: 'Delete', run: async () => { if (await confirmBox('Delete', `Delete ${base(p)}${isDir ? ' and everything inside' : ''}? This cannot be undone.`, true)) { await POST('/api/fs/delete', { path: p }).catch(fail); D.onDeleted(p); renderTree(); } } }, '-',
    { label: 'Download' + (isDir ? ' (.tar.gz)' : ''), run: () => (location.href = '/api/fs/download?path=' + encodeURIComponent(p)) },
    { label: 'Export to USB stick…', run: () => D.page('usb', { src: p }) },
    { label: 'Share on LAN/Wi-Fi…', run: () => D.page('network', { share: dir }) },
    isDir ? { label: 'Save as Maker template…', run: async () => { const n = await ask('Template name', base(p)); if (n) POST('/api/maker/save-template', { dir: p, name: n }).then(() => toast('Template saved', 'ok')).catch(fail); } } : { label: 'Copy path', run: () => navigator.clipboard.writeText(p) },
  ]);
}

async function newFile(dir) { const n = await ask('New file name', ''); if (!n) return; const p = join(dir, n); await PUT('/api/fs/write', { path: p, content: '' }).catch(fail); D.expanded.add(dir); await renderTree(); D.openFile(p); }
async function newDir(dir) { const n = await ask('New folder name', ''); if (!n) return; await POST('/api/fs/mkdir', { path: join(dir, n) }).catch(fail); D.expanded.add(dir); renderTree(); }
D.newFile = () => newFile(selected && !selected.includes('.') ? selected : D.cwd);

D.initFiles = () => {
  $('#fNewFile').onclick = () => newFile(D.cwd); $('#fNewDir').onclick = () => newDir(D.cwd);
  $('#fUp').onclick = () => D.loadDir(dirOf(D.cwd)); $('#fHome').onclick = () => D.loadDir(D.settings.home || D.info.home); $('#fRefresh').onclick = renderTree;
  $('#tree').oncontextmenu = (e) => { if (e.target.id === 'tree') { e.preventDefault(); fileMenu(e.clientX, e.clientY, D.cwd, true); } };
  const tree = $('#tree');
  tree.ondragover = (e) => e.preventDefault();
  tree.ondrop = async (e) => {
    e.preventDefault(); const row = e.target.closest('.row'); const dir = row && row.dataset.dir ? row.dataset.path : D.cwd;
    for (const f of e.dataTransfer.files) { await api('POST', '/api/fs/upload?path=' + encodeURIComponent(join(dir, f.name)), f, true).catch(fail); }
    toast(`Uploaded ${e.dataTransfer.files.length} file(s)`, 'ok'); renderTree();
  };
  $('#searchForm').onsubmit = async (e) => {
    e.preventDefault(); const q = $('#searchQ').value.trim(); if (!q) return;
    const box = $('#searchRes'); box.innerHTML = '<div class="sr muted">searching…</div>';
    const r = await GET(`/api/search?q=${encodeURIComponent(q)}&root=${encodeURIComponent(D.cwd)}`).catch(fail); box.innerHTML = '';
    if (!r || !r.results.length) return box.append(h('div', { class: 'sr muted' }, 'No results'));
    r.results.forEach((m) => box.append(h('div', { class: 'sr', onclick: () => D.openFile(m.file, m.line) }, h('div', {}, m.text.trim()), h('small', {}, `${m.file.replace(D.cwd + '/', '')}:${m.line}`))));
  };
};
