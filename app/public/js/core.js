'use strict';
// Shared helpers + global namespace
window.D = { settings: {}, info: {}, langs: [], cwd: '', ready: [] };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  kids.flat().forEach((c) => e.append(c instanceof Node ? c : document.createTextNode(c ?? '')));
  return e;
}
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";   // shell quote
const base = (p) => p.split('/').filter(Boolean).pop() || '/';
const dirOf = (p) => p.replace(/\/[^/]*\/?$/, '') || '/';
const join = (a, b) => (a.endsWith('/') ? a : a + '/') + b;
const human = (n) => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; };

async function api(method, url, body, raw) {
  const r = await fetch(url, { method, headers: body && !raw ? { 'content-type': 'application/json' } : {}, body: raw ? body : body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
const GET = (u) => api('GET', u);
const POST = (u, b) => api('POST', u, b || {});
const PUT = (u, b) => api('PUT', u, b);

function toast(msg, kind = '', ms = 3500) {
  const t = h('div', { class: 'toast ' + kind }, msg);
  $('#toasts').append(t);
  setTimeout(() => t.remove(), ms);
}
const fail = (e) => toast(e.message || String(e), 'err', 6000);

function modal(build) {
  return new Promise((resolve) => {
    const box = $('#modal .modal-box'); box.innerHTML = '';
    const close = (v) => { $('#modal').hidden = true; resolve(v); };
    build(box, close);
    $('#modal').hidden = false;
    const f = box.querySelector('input,select,button.primary'); if (f) f.focus();
    $('#modal').onclick = (e) => { if (e.target.id === 'modal') close(null); };
  });
}
const ask = (title, value = '', placeholder = '') => modal((box, close) => {
  const inp = h('input', { value, placeholder, onkeydown: (e) => { if (e.key === 'Enter') close(inp.value); if (e.key === 'Escape') close(null); } });
  box.append(h('h3', {}, title), inp, h('div', { class: 'btns' }, h('button', { onclick: () => close(null) }, 'Cancel'), h('button', { class: 'primary', onclick: () => close(inp.value) }, 'OK')));
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
});
const confirmBox = (title, text, danger) => modal((box, close) => {
  box.append(h('h3', {}, title), h('p', {}, text), h('div', { class: 'btns' }, h('button', { onclick: () => close(false) }, 'Cancel'), h('button', { class: danger ? 'danger' : 'primary', onclick: () => close(true) }, 'OK')));
});

function menu(x, y, items) {
  const m = $('#menu'); m.innerHTML = '';
  items.forEach((it) => {
    if (it === '-') return m.append(h('hr'));
    m.append(h('div', { onclick: () => { hideMenu(); it.run(); } }, h('span', {}, it.label), h('small', {}, it.key || '')));
  });
  m.hidden = false;
  m.style.left = Math.min(x, innerWidth - 240) + 'px'; m.style.top = Math.min(y, innerHeight - m.offsetHeight - 10) + 'px';
}
const hideMenu = () => { $('#menu').hidden = true; };
addEventListener('click', hideMenu);
addEventListener('blur', hideMenu);

const langByExt = (path) => {
  const name = base(path); const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return D.langs.find((l) => (l.names || []).includes(name)) || D.langs.find((l) => l.exts.includes(ext)) || D.langs.find((l) => l.id === 'plaintext');
};
const setStatus = (msg, ms = 4000) => { $('#stMsg').textContent = msg; clearTimeout(setStatus.t); setStatus.t = setTimeout(() => ($('#stMsg').textContent = ''), ms); };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

D.resolveTheme = () => { const t = D.settings.theme; if (t && t !== 'system') return t; return matchMedia('(prefers-color-scheme: light)').matches ? 'devos-light' : 'devos-dark'; };
D.themeAttr = () => ({ 'devos-light': 'light', 'devos-hc': 'hc' }[D.resolveTheme()] || 'dark');
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => D.applySettings && D.applySettings());
