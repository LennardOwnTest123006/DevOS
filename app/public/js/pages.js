'use strict';
// Full-size pages: Custom Maker, Network, USB, Tools, Settings + web preview
function showPage(name) {
  $('#pageWrap').hidden = !name;
  const panel = $('#panel');
  if (name && !D.panelHidden) { D.panelHidden = true; D.panelWasMin = panel.classList.contains('min'); panel.classList.add('min'); }
  if (!name && D.panelHidden) { D.panelHidden = false; if (!D.panelWasMin) panel.classList.remove('min'); }
  $$('#activity [data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
}
window.showPage = showPage;
D.page = async (name, arg) => {
  const box = $('#page'); box.innerHTML = '<p class="muted">loading…</p>'; showPage(name);
  try { box.innerHTML = ''; await PAGES[name](box, arg || {}); } catch (e) { box.append(h('p', { class: 'bad' }, e.message)); }
};
const field = (label, input) => [h('label', {}, label), input];
const select = (opts, value, onchange) => { const s = h('select', { onchange: () => onchange(s.value) }, ...opts.map(([v, n]) => h('option', { value: v }, n))); s.value = value; return s; };
const saveSettings = debounce(async () => { D.settings = await PUT('/api/settings', D.settings).catch(fail); D.applySettings(); }, 300);
const setting = (k, v) => { D.settings[k] = v; D.applySettings(); saveSettings(); };

const PAGES = {
  // ---------------------------------------------------------------------------- Custom Maker
  async maker(box) {
    const { templates } = await GET('/api/maker/templates');
    box.append(h('h2', {}, '🛠️ Custom Maker'), h('p', { class: 'muted' }, 'Create projects from templates, save your own templates and define your own languages / run commands.'));
    box.append(h('h3', {}, 'New project'));
    const name = h('input', { value: 'my-project', style: 'width:220px' });
    const parent = h('input', { value: D.cwd, style: 'width:340px' });
    box.append(h('div', { class: 'form' }, ...field('Project name', name), ...field('Create in folder', parent)));
    const createFrom = async (id) => {
      try { const r = await POST('/api/maker/create', { template: id, name: name.value, parent: parent.value }); toast(`Created ${r.dir}`, 'ok');
        D.expanded.add(parent.value); showPage(null);
        const first = await GET('/api/fs/list?path=' + encodeURIComponent(r.dir)); const f = first.entries.find((e) => !e.dir && !e.name.startsWith('.'));
        D.expanded.add(r.dir); if (f) D.openFile(join(r.dir, f.name)); D.loadDir(D.cwd);
      } catch (e) { fail(e); } };
    const pick = select(templates.map((t) => [t.id, t.name + ' - ' + t.desc]), templates[0].id, () => {});
    box.append(h('div', { class: 'pickrow' }, h('b', {}, 'Template:'), pick, h('button', { class: 'primary', onclick: () => createFrom(pick.value) }, 'Create project')),
      h('p', { class: 'muted' }, 'Or click a card below (scroll down with the mouse wheel, the scrollbar on the right, or PageDown):'));
    const cards = h('div', { class: 'cards', style: 'margin-top:12px' });
    templates.forEach((t) => cards.append(h('div', { class: 'card click', onclick: async () => {
      try { const r = await POST('/api/maker/create', { template: t.id, name: name.value, parent: parent.value }); toast(`Created ${r.dir}`, 'ok');
        D.expanded.add(parent.value); await D.loadDir(parent.value === D.cwd ? D.cwd : D.cwd); showPage(null);
        const first = await GET('/api/fs/list?path=' + encodeURIComponent(r.dir)); const f = first.entries.find((e) => !e.dir && !e.name.startsWith('.'));
        D.expanded.add(r.dir); if (f) D.openFile(join(r.dir, f.name)); D.loadDir(D.cwd);
      } catch (e) { fail(e); } } },
      h('h4', {}, t.name), h('div', { class: 'muted' }, t.desc), t.user ? h('button', { style: 'margin-top:6px', onclick: async (ev) => { ev.stopPropagation(); await POST('/api/maker/delete-template', { id: t.id }).catch(fail); D.page('maker'); } }, 'delete') : '')));
    box.append(cards);

    box.append(h('h3', {}, 'Run profiles (what the ▶ Run button does)'), h('p', { class: 'muted' }, 'Placeholders: {file} {dir} {base} {name}. Leave empty for the default. Saved automatically.'));
    const tbl = h('table', { class: 't' }, h('tr', {}, h('th', {}, 'Language'), h('th', {}, 'Command')));
    D.langs.filter((l) => l.run && !l.run.startsWith('@')).forEach((l) => {
      const inp = h('input', { style: 'width:100%', placeholder: l.run, value: (D.settings.runners || {})[l.id] || '', oninput: () => { const r = { ...(D.settings.runners || {}) }; if (inp.value) r[l.id] = inp.value; else delete r[l.id]; setting('runners', r); } });
      tbl.append(h('tr', {}, h('td', {}, l.name), h('td', {}, inp)));
    });
    box.append(tbl);

    box.append(h('h3', {}, 'Add your own language'));
    const cn = h('input', { placeholder: 'Name e.g. Zig' }), ce = h('input', { placeholder: 'extension e.g. zig' }), cr = h('input', { placeholder: 'run command e.g. zig run {file}' });
    const cm = select(D.monaco.languages.getLanguages().map((l) => [l.id, l.aliases ? l.aliases[0] : l.id]), 'plaintext', () => {});
    box.append(h('div', { class: 'form' }, ...field('Name', cn), ...field('File extension', ce), ...field('Colours like', cm), ...field('Run command', cr)),
      h('p', {}, h('button', { class: 'primary', onclick: () => {
        if (!cn.value || !ce.value) return toast('Name and extension are required', 'err');
        const list = [...(D.settings.customLanguages || []), { name: cn.value, ext: ce.value.replace(/^\./, ''), monaco: cm.value, run: cr.value }];
        setting('customLanguages', list); registerCustom(); toast('Language added', 'ok'); D.page('maker');
      } }, 'Add language')));
    (D.settings.customLanguages || []).forEach((c, i) => box.append(h('p', {}, `${c.name} (.${c.ext}) → ${c.run || '—'} `, h('button', { onclick: () => { setting('customLanguages', D.settings.customLanguages.filter((_, j) => j !== i)); location.reload(); } }, 'remove'))));
  },

  // ---------------------------------------------------------------------------- Network
  async network(box, arg) {
    const n = await GET('/api/net');
    box.append(h('h2', {}, '📶 Network, Wi-Fi & sharing'));
    box.append(h('h3', {}, 'This computer'), h('table', { class: 't' }, ...n.lan.map((a) => h('tr', {}, h('td', {}, a.iface), h('td', {}, a.address)))), n.lan.length ? '' : h('p', { class: 'warn' }, 'No network connection yet.'));
    box.append(h('h3', {}, 'Wi-Fi'));
    if (!n.available) box.append(h('p', { class: 'muted' }, 'NetworkManager (nmcli) is not available here. Inside the DevOS ISO this lists Wi-Fi networks.'));
    else {
      const t = h('table', { class: 't' }, h('tr', {}, h('th', {}, 'Network'), h('th', {}, 'Signal'), h('th', {}, 'Security'), h('th', {})));
      n.networks.forEach((w) => t.append(h('tr', {}, h('td', {}, (w.inUse ? '✔ ' : '') + w.ssid), h('td', {}, w.signal + '%'), h('td', {}, w.security || 'open'),
        h('td', {}, h('button', { onclick: async () => { const pw = w.security ? await ask(`Password for ${w.ssid}`, '') : ''; if (pw === null) return; toast('Connecting…'); POST('/api/net/connect', { ssid: w.ssid, password: pw }).then(() => { toast('Connected', 'ok'); D.page('network'); }).catch(fail); } }, w.inUse ? 'reconnect' : 'connect')))));
      box.append(t, h('p', {}, h('button', { onclick: () => D.page('network') }, '⟳ rescan')), h('p', { class: 'muted' }, 'Ethernet/LAN connects automatically (DHCP). Hidden networks: run in the terminal  nmcli device wifi connect SSID password PASS hidden yes'));
    }
    box.append(h('h3', {}, 'Share a folder on LAN / Wi-Fi (read-only download)'), h('p', { class: 'muted' }, 'Other computers on the same network can download files in a browser. Sharing stops automatically after the chosen time.'));
    const dir = h('input', { value: arg.share || D.cwd, style: 'width:100%' }), port = h('input', { type: 'number', value: 8080 }), min = h('input', { type: 'number', value: 30 });
    box.append(h('div', { class: 'form' }, ...field('Folder', dir), ...field('Port', port), ...field('Stop after (minutes)', min)));
    const list = h('div'); box.append(h('p', {}, h('button', { class: 'primary', onclick: async () => { try { await POST('/api/share/start', { dir: dir.value, port: +port.value, minutes: +min.value }); refresh(); } catch (e) { fail(e); } } }, 'Start sharing')), list);
    const refresh = async () => { const r = await GET('/api/share'); list.innerHTML = ''; r.shares.forEach((s) => list.append(h('div', { class: 'card' }, h('b', {}, s.dir), h('div', {}, s.urls.map((u) => h('div', {}, h('code', {}, u)))), h('button', { onclick: async () => { await POST('/api/share/stop', { port: s.port }); refresh(); } }, 'Stop')))); };
    refresh();
    box.append(h('h3', {}, 'Use DevOS from another computer'), h('p', { class: 'muted' }, 'By default DevOS only listens on this machine (safe). To open it from another PC on the same network, start it with  DEVOS_HOST=0.0.0.0 devos  and open  http://<ip>:7777/?t=<token>  - the token is in ~/.devos/token. Anyone with the token has a shell, so only do this on networks you trust.'));
  },

  // ---------------------------------------------------------------------------- USB
  async usb(box, arg) {
    const r = await GET('/api/usb/list');
    box.append(h('h2', {}, '💾 USB sticks & export'), h('p', { class: 'muted' }, 'Copy a project or folder to a USB stick as a .tar.gz archive (works on Linux, macOS and Windows 10/11), then eject safely.'));
    const src = h('input', { value: arg.src || D.cwd, style: 'width:100%' });
    box.append(h('div', { class: 'form' }, ...field('Folder / file to export', src)));
    if (r.error) box.append(h('p', { class: 'warn' }, r.error));
    const t = h('table', { class: 't' }, h('tr', {}, h('th', {}, 'Device'), h('th', {}, 'Name'), h('th', {}, 'Size'), h('th', {}, 'Mounted at'), h('th', {})));
    r.devices.forEach((d) => t.append(h('tr', {}, h('td', {}, d.path), h('td', {}, (d.label || d.model || '') + ' ' + (d.fstype || '')), h('td', {}, human(d.size)), h('td', {}, d.mountpoint || '—'),
      h('td', {}, h('button', { class: 'primary', onclick: async () => {
        try { const mp = d.mountpoint || (await POST('/api/usb/mount', { device: d.path })).mountpoint; const x = await POST('/api/usb/export', { src: src.value, mountpoint: mp }); toast('Exported to ' + x.file, 'ok', 8000); D.page('usb', { src: src.value }); } catch (e) { fail(e); } } }, 'Export here'),
        ' ', h('button', { onclick: async () => { const x = await POST('/api/usb/eject', { device: d.path }).catch(fail); if (x) { toast(x.message, 'ok'); D.page('usb', { src: src.value }); } } }, 'Eject')))));
    box.append(r.devices.length ? t : h('p', { class: 'muted' }, 'No USB stick found. Plug one in and press refresh. '), h('button', { onclick: () => D.page('usb', { src: src.value }) }, '⟳ refresh'));
    box.append(h('h3', {}, 'Files from USB to here'), h('p', { class: 'muted' }, 'USB sticks mount automatically under /media. Use the Explorer → ⬆ / open folder, or in the terminal:  ls /media/$USER'));
    box.append(h('h3', {}, 'Write the DevOS ISO to a new USB stick (from inside DevOS)'),
      h('pre', {}, 'lsblk                              # find your stick, e.g. /dev/sdb  (NOT your system disk!)\nsudo devos-usb flash /path/DevOS.iso /dev/sdX   # asks you to type the device name to confirm'));
  },

  // ---------------------------------------------------------------------------- Tools
  async tools(box) {
    const info = await GET('/api/info');
    box.append(h('h2', {}, '🧰 Languages & tools'), h('p', { class: 'muted' }, 'Everything detected on this machine. Missing something? Open the terminal and install it, e.g. sudo apt install kotlin dotnet-sdk-8.0 …'));
    const t = h('table', { class: 't' }, h('tr', {}, h('th', {}, 'Tool'), h('th', {}, 'Status'), h('th', {}, 'Version')));
    info.tools.forEach((x) => t.append(h('tr', {}, h('td', {}, x.bin), h('td', { class: x.installed ? 'ok' : 'bad' }, x.installed ? '✔ installed' : '✖ missing'), h('td', { class: 'muted' }, x.version || ''))));
    box.append(t, h('h3', {}, 'Supported file types (colours + runner)'), h('div', { class: 'cards' }, ...D.langs.map((l) => h('div', { class: 'card' }, h('b', {}, l.name), h('div', { class: 'muted' }, '.' + l.exts.join(' .')), h('div', {}, l.run ? '▶ run' : '', l.hasChecker ? ' · red underline' : '')))));
  },

  // ---------------------------------------------------------------------------- Settings
  async settings(box) {
    const s = D.settings; const info = await GET('/api/info');
    box.append(h('h2', {}, '⚙️ Settings'), h('p', { class: 'muted' }, 'Changes apply instantly and are saved in ' + info.data + '/settings.json'));
    const num = (k, min, max) => h('input', { type: 'number', min, max, value: s[k], oninput: (e) => setting(k, +e.target.value) });
    const chk = (k) => h('input', { type: 'checkbox', checked: !!s[k], onchange: (e) => setting(k, e.target.checked) });
    box.append(h('h3', {}, 'Appearance'), h('div', { class: 'form' },
      ...field('Theme', select([['system', 'Match system (recommended)'], ['devos-dark', 'DevOS Dark'], ['devos-light', 'DevOS Light'], ['devos-hc', 'High contrast']], s.theme, (v) => setting('theme', v))),
      ...field('Editor font size', num('fontSize', 8, 40)), ...field('Terminal font size', num('termFontSize', 8, 40)),
      ...field('Font family', h('input', { value: s.fontFamily, onchange: (e) => setting('fontFamily', e.target.value) })), ...field('Font ligatures', chk('ligatures')), ...field('Minimap', chk('minimap'))));
    box.append(h('h3', {}, 'Editor'), h('div', { class: 'form' },
      ...field('Tab size', num('tabSize', 1, 16)), ...field('Insert spaces', chk('insertSpaces')),
      ...field('Word wrap', select([['off', 'off'], ['on', 'on']], s.wordWrap, (v) => setting('wordWrap', v))),
      ...field('Line numbers', select([['on', 'on'], ['relative', 'relative'], ['off', 'off']], s.lineNumbers, (v) => setting('lineNumbers', v))),
      ...field('Auto save', select([['afterDelay', 'after a short delay'], ['off', 'off (Ctrl+S)']], s.autosave, (v) => setting('autosave', v))),
      ...field('Format on save', chk('formatOnSave')), ...field('Check code while typing (red underlines)', chk('checkOnType')), ...field('Check delay (ms)', num('checkDelay', 100, 5000))));
    if (info.live) box.append(h('h3', {}, 'Keyboard'), h('div', { class: 'form' }, ...field('Layout', select([['us', 'English (US)'], ['gb', 'English (UK)'], ['de', 'Deutsch'], ['fr', 'Français'], ['es', 'Español'], ['it', 'Italiano'], ['pt', 'Português'], ['pl', 'Polski'], ['ru', 'Русский'], ['tr', 'Türkçe'], ['se', 'Svenska'], ['ch', 'Schweiz']], localStorage.getItem('devos.kb') || 'us', (v) => POST('/api/keyboard', { layout: v }).then(() => { localStorage.setItem('devos.kb', v); toast('Keyboard layout: ' + v, 'ok'); }).catch(fail)))));
    box.append(h('h3', {}, 'Workspace'), h('div', { class: 'form' }, ...field('Home folder', h('input', { value: s.home, onchange: (e) => setting('home', e.target.value) }))));
    box.append(h('h3', {}, 'System'), h('table', { class: 't' },
      ...[['DevOS', info.version], ['Node.js', info.node], ['System', info.platform], ['Host / user', `${info.hostname} / ${info.user}`], ['CPU / RAM', `${info.cpus} cores / ${human(info.mem.total)}`], ['Mode', info.live ? 'Live USB/ISO (nothing is written to your disks)' : 'Installed app']].map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b)))));
    box.append(h('p', {}, h('button', { onclick: async () => { if (await confirmBox('Reset settings', 'Restore all default settings?')) { D.settings = await POST('/api/settings/reset'); D.applySettings(); D.page('settings'); } } }, 'Reset settings'), ' ',
      info.live ? [h('button', { onclick: () => POST('/api/power', { action: 'reboot' }).catch(fail) }, '↻ Reboot'), ' ', h('button', { class: 'danger', onclick: () => POST('/api/power', { action: 'poweroff' }).catch(fail) }, '⏻ Shut down')] : ''));
  },
};

function registerCustom() {
  D.langs = D.langs.filter((l) => !l.custom);
  (D.settings.customLanguages || []).forEach((c) => D.langs.unshift({ id: 'custom-' + c.ext, name: c.name, monaco: c.monaco || 'plaintext', exts: [c.ext], run: c.run, custom: true, hasChecker: false }));
}
window.registerCustom = registerCustom;

// ---------------------------------------------------------------------------- web preview / mini browser
D.previewPath = null;
// Open a project file in the real system browser (Epiphany). HTML is served by a local preview server.
D.openInBrowser = async (path) => {
  if (/\.(md|markdown)$/i.test(path)) return D.preview(path);
  try {
    if (D.info.live) { const r = await POST('/api/preview/open', { path }); toast('Opened in browser: ' + r.url, 'ok'); }
    else { const r = await POST('/api/preview/url', { path }); window.open(r.url, '_blank'); }
  } catch (e) { fail(e); D.preview(path); }
};
// Mini browser pane inside DevOS (for dev servers and project files)
D.preview = async (target) => {
  const wrap = $('#previewWrap'); wrap.hidden = false; showPage(null);
  const frame = $('#pvFrame'), url = $('#pvUrl'); D.previewPath = null;
  if (!target) { frame.src = 'about:blank'; url.value = ''; return; }
  if (/^https?:\/\//i.test(target)) { frame.removeAttribute('srcdoc'); frame.src = target; url.value = target; return; }
  D.previewPath = target; url.value = target;
  if (/\.(md|markdown)$/i.test(target)) { const r = await GET('/api/fs/read?path=' + encodeURIComponent(target)).catch(fail); if (r) frame.srcdoc = renderMd(r.content); return; }
  try { const r = await POST('/api/preview/url', { path: target }); frame.removeAttribute('srcdoc'); frame.src = r.url + (r.url.includes('?') ? '&' : '?') + 'v=' + Date.now(); url.value = r.url; } catch (e) { fail(e); }
};
D.reloadPreview = () => { if (D.previewPath) D.preview(D.previewPath); else { const f = $('#pvFrame'); try { f.contentWindow.location.reload(); } catch (_) { f.src = f.src; } } };
function renderMd(src) {
  let html = esc(src).replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>').replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>').replace(/^[-*] (.*)$/gm, '<li>$1</li>').replace(/\n\n/g, '<br><br>');
  return `<body style="font-family:system-ui;max-width:760px;margin:20px auto;padding:0 16px;line-height:1.5">${html}</body>`;
}
