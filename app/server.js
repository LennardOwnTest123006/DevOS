#!/usr/bin/env node
'use strict';
// DevOS server - zero npm dependencies. Serves the UI, file API, terminal (WebSocket+PTY),
// code checker, maker, USB / network / share helpers.
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const cp = require('child_process');
const { upgrade } = require('./lib/ws');
const { createPty } = require('./lib/pty');
const LANGS = require('./lib/languages');
const { checkCode, which } = require('./lib/check');
const maker = require('./lib/maker');
const sys = require('./lib/system');

const PORT = Number(process.env.DEVOS_PORT || 7777);
const HOST = process.env.DEVOS_HOST || '127.0.0.1';     // 127.0.0.1 = this machine only (safe default)
const DATA = process.env.DEVOS_DATA || path.join(os.homedir(), '.devos');
const PUBLIC = path.join(__dirname, 'public');
const LIVE = process.env.DEVOS_LIVE === '1';
fs.mkdirSync(DATA, { recursive: true, mode: 0o700 });
process.env.DEVOS_DATA = DATA;

// ---- access token: terminal = shell access, so every request must carry it -------------
const TOKEN_FILE = path.join(DATA, 'token');
let TOKEN = process.env.DEVOS_TOKEN || '';
if (!TOKEN) {
  try { TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch (_) { /* first run */ }
}
if (!TOKEN) {
  TOKEN = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(TOKEN_FILE, TOKEN + '\n', { mode: 0o600 });
}
const tokenOk = (given) => {
  const a = Buffer.from(String(given || '')), b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const cookieOf = (req, name) => {
  const m = new RegExp('(?:^|;\\s*)' + name + '=([^;]+)').exec(req.headers.cookie || '');
  return m ? decodeURIComponent(m[1]) : '';
};
const authed = (req) => tokenOk(cookieOf(req, 'devos_token')) || tokenOk(req.headers['x-devos-token']);
// DNS-rebinding protection: only accept our own host names unless LAN mode was chosen on purpose
const hostOk = (req) => {
  if (HOST !== '127.0.0.1' && HOST !== '::1' && HOST !== 'localhost') return true;
  const h = (req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return ['localhost', '127.0.0.1', '::1'].includes(h);
};

// ---- settings ---------------------------------------------------------------------------
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const DEFAULTS = {
  theme: 'system', fontSize: 14, fontFamily: "'JetBrains Mono','Fira Code','DejaVu Sans Mono',monospace",
  tabSize: 4, insertSpaces: true, wordWrap: 'off', minimap: true, ligatures: false, lineNumbers: 'on',
  autosave: 'afterDelay', autosaveDelay: 1200, checkOnType: true, checkDelay: 600, formatOnSave: false,
  termFontSize: 13, home: os.homedir(), runners: {}, customLanguages: [], sidebarWidth: 270, panelHeight: 280,
};
const loadSettings = () => {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) }; } catch (_) { return { ...DEFAULTS }; }
};

// ---- helpers ----------------------------------------------------------------------------
const MIME = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff',
  ttf: 'font/ttf', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', wasm: 'application/wasm', map: 'application/json',
};
const mimeOf = (f) => MIME[path.extname(f).slice(1).toLowerCase()] || 'application/octet-stream';
const expand = (p) => path.resolve(String(p || '~').replace(/^~(?=$|[\\/])/, os.homedir()));
const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const readBody = (req, limit = 64 * 1024 * 1024) => new Promise((resolve, reject) => {
  const parts = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('Body too large')); req.destroy(); } else parts.push(c); });
  req.on('end', () => resolve(Buffer.concat(parts)));
  req.on('error', reject);
});
const readJson = async (req) => { const b = await readBody(req, 8 * 1024 * 1024); return b.length ? JSON.parse(b.toString('utf8')) : {}; };

let toolCache = null;
async function tools() {
  if (toolCache) return toolCache;
  const list = [
    ['node', ['--version']], ['npm', ['--version']], ['python3', ['--version']], ['gcc', ['--version']], ['g++', ['--version']],
    ['make', ['--version']], ['cmake', ['--version']], ['java', ['-version']], ['go', ['version']], ['rustc', ['--version']],
    ['cargo', ['--version']], ['php', ['--version']], ['ruby', ['--version']], ['lua5.4', ['-v']], ['perl', ['--version']],
    ['tsc', ['--version']], ['tsx', ['--version']], ['git', ['--version']], ['sqlite3', ['--version']], ['Rscript', ['--version']],
    ['bash', ['--version']],
  ];
  toolCache = (await Promise.all(list.map(async ([bin, args]) => {
    if (!which(bin)) return { bin, installed: false };
    const r = await sys.run(bin, args, { timeout: 5000 });
    const line = ((r.stdout || r.stderr).split('\n').find((l) => /\d/.test(l)) || '').trim().slice(0, 80);
    return { bin, installed: true, version: line };
  })));
  return toolCache;
}

function walkSearch(q, root) {
  return new Promise((resolve) => {
    cp.execFile('grep', ['-rIn', '--binary-files=without-match', '-m', '20', '-F', '--exclude-dir=node_modules', '--exclude-dir=.git',
      '--exclude-dir=vendor', '--exclude-dir=target', '--', q, root], { timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (_e, out) => {
      resolve(out.split('\n').filter(Boolean).slice(0, 300).map((l) => {
        const m = /^(.*?):(\d+):(.*)$/.exec(l); return m ? { file: m[1], line: +m[2], text: m[3].slice(0, 200) } : null;
      }).filter(Boolean));
    });
  });
}

// ---- API --------------------------------------------------------------------------------
const api = {
  'GET /api/info': async () => ({
    version: require('./package.json').version, node: process.version, platform: `${os.type()} ${os.release()} ${os.arch()}`,
    hostname: os.hostname(), user: os.userInfo().username, home: os.homedir(), live: LIVE, data: DATA,
    mem: { total: os.totalmem(), free: os.freemem() }, cpus: os.cpus().length, tools: await tools(), lan: sys.lanAddresses(),
  }),
  'GET /api/languages': async () => LANGS.map(({ check, ...l }) => ({ ...l, hasChecker: !!(check && (check.cmd || check.monaco)), monacoChecks: !!(check && check.monaco) })),
  'GET /api/settings': async () => loadSettings(),
  'PUT /api/settings': async (req) => { const s = { ...loadSettings(), ...(await readJson(req)) }; await fsp.writeFile(SETTINGS_FILE, JSON.stringify(s, null, 2)); return s; },
  'POST /api/settings/reset': async () => { await fsp.rm(SETTINGS_FILE, { force: true }); return loadSettings(); },

  'GET /api/fs/list': async (req, q) => {
    const dir = expand(q.get('path'));
    const ents = await fsp.readdir(dir, { withFileTypes: true });
    const out = await Promise.all(ents.map(async (e) => {
      let st = null; try { st = await fsp.stat(path.join(dir, e.name)); } catch (_) { /* broken link */ }
      return { name: e.name, dir: st ? st.isDirectory() : e.isDirectory(), size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0, link: e.isSymbolicLink() };
    }));
    out.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    return { path: dir, parent: path.dirname(dir), entries: out };
  },
  'GET /api/fs/read': async (req, q) => {
    const f = expand(q.get('path')); const st = await fsp.stat(f);
    if (st.size > 20 * 1024 * 1024) throw new Error('File larger than 20 MB - open it in the terminal');
    const buf = await fsp.readFile(f);
    if (buf.subarray(0, 8000).includes(0)) return { path: f, binary: true, size: st.size };
    return { path: f, content: buf.toString('utf8'), mtime: st.mtimeMs, size: st.size };
  },
  'PUT /api/fs/write': async (req) => {
    const b = await readJson(req); const f = expand(b.path);
    await fsp.mkdir(path.dirname(f), { recursive: true });
    const tmp = f + '.devos-tmp-' + process.pid;
    await fsp.writeFile(tmp, b.content, { mode: (await fsp.stat(f).catch(() => ({ mode: 0o644 }))).mode & 0o7777 });
    await fsp.rename(tmp, f);              // atomic: a crash can never leave a half-written file
    return { ok: true, mtime: (await fsp.stat(f)).mtimeMs };
  },
  'POST /api/fs/mkdir': async (req) => { await fsp.mkdir(expand((await readJson(req)).path), { recursive: true }); return { ok: true }; },
  'POST /api/fs/rename': async (req) => { const b = await readJson(req); await fsp.rename(expand(b.from), expand(b.to)); return { ok: true }; },
  'POST /api/fs/copy': async (req) => { const b = await readJson(req); await fsp.cp(expand(b.from), expand(b.to), { recursive: true, errorOnExist: true, force: false }); return { ok: true }; },
  'POST /api/fs/delete': async (req) => {
    const f = expand((await readJson(req)).path);
    if (f === '/' || f === os.homedir()) throw new Error('Refusing to delete this folder');
    await fsp.rm(f, { recursive: true, force: true }); return { ok: true };
  },
  'POST /api/fs/upload': async (req, q) => {
    const f = expand(q.get('path')); await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.writeFile(f, await readBody(req)); return { ok: true, path: f };
  },
  'GET /api/search': async (req, q) => ({ results: q.get('q') ? await walkSearch(q.get('q'), expand(q.get('root'))) : [] }),
  'GET /api/project': async (req, q) => {
    let d = expand(q.get('path')); if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) d = path.dirname(d);
    for (let i = 0; i < 8; i++) {
      const f = path.join(d, '.devos.json');
      if (fs.existsSync(f)) { try { return { dir: d, ...JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch (_) { /* ignore */ } }
      const up = path.dirname(d); if (up === d) break; d = up;
    }
    return {};
  },

  'POST /api/check': async (req) => { const b = await readJson(req); return checkCode({ langId: b.lang, code: b.code, filePath: b.path ? expand(b.path) : '' }); },

  'GET /api/maker/templates': async () => ({ templates: maker.list() }),
  'POST /api/maker/create': async (req) => { const b = await readJson(req); return maker.create({ template: b.template, name: b.name, parent: expand(b.parent) }); },
  'POST /api/maker/save-template': async (req) => { const b = await readJson(req); return maker.saveAsTemplate({ dir: expand(b.dir), name: b.name }); },
  'POST /api/maker/delete-template': async (req) => { maker.deleteTemplate((await readJson(req)).id); return { ok: true }; },

  'GET /api/usb/list': async () => sys.usbList(),
  'POST /api/usb/mount': async (req) => ({ mountpoint: await sys.usbMount((await readJson(req)).device) }),
  'POST /api/usb/eject': async (req) => ({ message: await sys.usbEject((await readJson(req)).device) }),
  'POST /api/usb/export': async (req) => { const b = await readJson(req); return { file: await sys.usbExport({ src: expand(b.src), mountpoint: b.mountpoint }) }; },

  'GET /api/net': async () => sys.wifiList(),
  'POST /api/net/connect': async (req) => ({ message: await sys.wifiConnect(await readJson(req)) }),
  'GET /api/share': async () => ({ shares: sys.shareList() }),
  'POST /api/share/start': async (req) => { const b = await readJson(req); return { shares: sys.shareStart({ ...b, dir: expand(b.dir) }) }; },
  'POST /api/share/stop': async (req) => ({ shares: sys.shareStop((await readJson(req)).port) }),

  'POST /api/browser/open': async (req) => { sys.openExternal((await readJson(req)).url); return { ok: true }; },
  'POST /api/power': async (req) => { if (!LIVE) throw new Error('Power control is only available inside the DevOS live system'); await sys.power((await readJson(req)).action); return { ok: true }; },
};

// ---- HTTP -------------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  try {
    if (!hostOk(req)) return send(res, 421, { error: 'Bad Host header' });
    const u = new URL(req.url, 'http://x');
    // first visit: /?t=TOKEN stores the cookie, then redirects to a clean URL
    if (u.pathname === '/' && u.searchParams.has('t')) {
      if (!tokenOk(u.searchParams.get('t'))) return send(res, 403, 'Wrong token', 'text/plain');
      return send(res, 302, '', 'text/plain', { location: '/', 'set-cookie': `devos_token=${TOKEN}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` });
    }
    if (u.pathname.startsWith('/vendor/') || u.pathname === '/js/monaco-worker.js' || u.pathname === '/login.html' || u.pathname === '/css/devos.css' || u.pathname === '/favicon.svg') return serveStatic(u.pathname, res);
    if (!authed(req)) {
      if (u.pathname === '/' || u.pathname === '/index.html') return serveStatic('/login.html', res);
      return send(res, 401, { error: 'Not signed in' });
    }
    // state-changing calls must come from our own page (CSRF)
    if (req.method !== 'GET' && req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return send(res, 403, { error: 'Bad origin' });

    const handler = api[`${req.method} ${u.pathname}`];
    if (handler) {
      try { return send(res, 200, await handler(req, u.searchParams)); }
      catch (e) { return send(res, e.code === 'ENOENT' ? 404 : 400, { error: e.message }); }
    }
    if (req.method === 'GET' && u.pathname === '/api/fs/download') {
      const f = expand(u.searchParams.get('path')); const st = await fsp.stat(f);
      if (st.isDirectory()) {
        res.writeHead(200, { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${path.basename(f)}.tar.gz"` });
        return cp.spawn('tar', ['-czf', '-', '-C', path.dirname(f), path.basename(f)]).stdout.pipe(res);
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': st.size, 'content-disposition': `attachment; filename="${path.basename(f)}"` });
      return fs.createReadStream(f).pipe(res);
    }
    if (req.method === 'GET' && u.pathname.startsWith('/raw/')) {          // live preview of project files
      const f = expand(decodeURIComponent(u.pathname.slice(4)));
      const target = fs.existsSync(f) && fs.statSync(f).isDirectory() ? path.join(f, 'index.html') : f;
      const st = await fsp.stat(target);
      res.writeHead(200, { 'content-type': mimeOf(target), 'content-length': st.size, 'cache-control': 'no-store' });
      return fs.createReadStream(target).pipe(res);
    }
    if (u.pathname.startsWith('/api/')) return send(res, 404, { error: 'Unknown API' });
    return serveStatic(u.pathname, res);
  } catch (e) {
    if (!res.headersSent) send(res, e.code === 'ENOENT' ? 404 : 500, { error: e.message });
  }
});

function serveStatic(p, res) {
  const rel = path.normalize(decodeURIComponent(p === '/' ? '/index.html' : p)).replace(/^([/\\])+/, '');
  const f = path.join(PUBLIC, rel);
  if (!f.startsWith(PUBLIC + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
  const long = rel.startsWith('vendor');
  res.writeHead(200, { 'content-type': mimeOf(f), 'cache-control': long ? 'public, max-age=86400' : 'no-cache', 'x-content-type-options': 'nosniff' });
  fs.createReadStream(f).pipe(res);
}

// ---- terminal WebSocket -----------------------------------------------------------------
server.on('upgrade', (req, socket) => {
  const u = new URL(req.url, 'http://x');
  const originOk = !req.headers.origin || new URL(req.headers.origin).host === req.headers.host;
  if (u.pathname !== '/ws/term' || !authed(req) || !hostOk(req) || !originOk) { socket.destroy(); return; }
  const ws = upgrade(req, socket);
  if (!ws) return;
  const term = createPty({ cwd: expand(u.searchParams.get('cwd') || '~'), cols: +u.searchParams.get('cols') || 80, rows: +u.searchParams.get('rows') || 24 });
  term.onData((d) => ws.send(d));
  term.onExit((code) => { ws.send(`\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`); setTimeout(() => ws.close(), 100); });
  ws.on('message', (m, isText) => {
    if (!isText) return term.write(m);
    try { const j = JSON.parse(m); if (j.t === 'i') term.write(j.d); else if (j.t === 'r') term.resize(j.c, j.r); } catch (_) { term.write(m); }
  });
  ws.on('close', () => term.kill());
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`DevOS ${require('./package.json').version} running`);
  console.log(`  open:   http://${shown}:${PORT}/?t=${TOKEN}`);
  console.log(`  token:  ${TOKEN_FILE}`);
  if (HOST !== '127.0.0.1') console.log('  WARNING: listening on the network - anyone with the token has a shell on this machine');
});
process.on('SIGTERM', () => process.exit(0));
