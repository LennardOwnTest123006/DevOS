'use strict';
// OS helpers: USB sticks, Wi-Fi/LAN, folder sharing, power, external browser.
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const run = (cmd, args, opts = {}) => new Promise((resolve) => {
  cp.execFile(cmd, args, { timeout: opts.timeout || 30000, maxBuffer: 8 * 1024 * 1024, env: opts.env || process.env }, (err, stdout, stderr) =>
    resolve({ ok: !err, code: err ? err.code : 0, stdout, stderr: stderr || (err && err.message) || '' }));
});

// try as the normal user first, then through passwordless sudo (live session)
async function priv(cmd, args, opts) {
  let r = await run(cmd, args, opts);
  if (!r.ok && process.getuid && process.getuid() !== 0) r = await run('sudo', ['-n', cmd, ...args], opts);
  return r;
}

const lanAddresses = () => Object.entries(os.networkInterfaces()).flatMap(([n, a]) =>
  (a || []).filter((x) => x.family === 'IPv4' && !x.internal).map((x) => ({ iface: n, address: x.address })));

async function usbList() {
  const r = await run('lsblk', ['-J', '-b', '-o', 'NAME,PATH,SIZE,RM,HOTPLUG,TRAN,TYPE,MOUNTPOINT,LABEL,FSTYPE,MODEL']);
  if (!r.ok) return { devices: [], error: 'lsblk not available: ' + r.stderr };
  const out = [];
  const walk = (n, parent) => {
    const removable = n.rm === true || n.rm === '1' || n.hotplug === true || n.tran === 'usb' || (parent && parent.removable);
    const dev = { path: n.path, name: n.name, size: Number(n.size), type: n.type, label: n.label, fstype: n.fstype,
      mountpoint: n.mountpoint, model: n.model || (parent && parent.model), removable };
    if (removable && n.type === 'part') out.push(dev);
    (n.children || []).forEach((c) => walk(c, dev));
  };
  (JSON.parse(r.stdout).blockdevices || []).forEach((n) => walk(n, null));
  return { devices: out };
}

async function usbMount(devPath) {
  if (!/^\/dev\/[a-zA-Z0-9]+$/.test(devPath)) throw new Error('bad device');
  const r = await run('udisksctl', ['mount', '-b', devPath]);
  const m = /at (.+?)\.?\s*$/m.exec(r.stdout + r.stderr);
  if (!m) throw new Error((r.stderr || r.stdout || 'mount failed').trim());
  return m[1];
}

async function usbEject(devPath) {
  if (!/^\/dev\/[a-zA-Z0-9]+$/.test(devPath)) throw new Error('bad device');
  await run('sync', []);
  const u = await run('udisksctl', ['unmount', '-b', devPath]);
  return u.ok ? 'Safe to remove the USB stick.' : (u.stderr || 'unmount failed').trim();
}

async function usbExport({ src, mountpoint }) {
  if (!mountpoint || !fs.statSync(mountpoint).isDirectory()) throw new Error('USB is not mounted');
  const base = path.basename(src) || 'export';
  const dstDir = path.join(mountpoint, 'DevOS-export');
  fs.mkdirSync(dstDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const dst = path.join(dstDir, `${base}-${stamp}.tar.gz`);
  const r = await run('tar', ['-czf', dst, '-C', path.dirname(src), base], { timeout: 600000 });
  if (!r.ok) throw new Error(r.stderr);
  await run('sync', []);
  return dst;
}

async function wifiList() {
  const dev = await run('nmcli', ['-t', '-f', 'DEVICE,TYPE,STATE,CONNECTION', 'device']);
  if (!dev.ok && /ENOENT|not found/i.test(dev.stderr)) return { available: false, lan: lanAddresses(), networks: [], devices: [] };
  await run('nmcli', ['device', 'wifi', 'rescan']);
  const wifi = await run('nmcli', ['-t', '-f', 'IN-USE,SSID,SIGNAL,SECURITY', 'device', 'wifi', 'list']);
  const split = (l) => l.split(/(?<!\\):/).map((x) => x.replace(/\\:/g, ':'));
  return {
    available: true,
    lan: lanAddresses(),
    devices: dev.stdout.split('\n').filter(Boolean).map(split).map(([device, type, state, connection]) => ({ device, type, state, connection })),
    networks: wifi.stdout.split('\n').filter(Boolean).map(split).map(([inuse, ssid, signal, security]) => ({ inUse: inuse === '*', ssid, signal: +signal, security })).filter((n) => n.ssid),
  };
}

async function wifiConnect({ ssid, password }) {
  if (!ssid) throw new Error('SSID required');
  const args = ['device', 'wifi', 'connect', ssid];
  if (password) args.push('password', password);
  const r = await priv('nmcli', args, { timeout: 60000 });
  if (!r.ok) throw new Error((r.stderr || r.stdout).trim());
  return r.stdout.trim();
}

const shares = new Map();
function shareStart({ dir, port = 8080, minutes = 30 }) {
  if (!fs.statSync(dir).isDirectory()) throw new Error('Not a folder');
  port = Number(port);
  if (!(port > 1024 && port < 65536)) throw new Error('Port must be 1025-65535');
  if (shares.has(port)) throw new Error('Port already shared');
  const child = cp.spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '0.0.0.0', '--directory', dir], { stdio: 'ignore' });
  const timer = setTimeout(() => shareStop(port), Math.max(1, minutes) * 60000);
  child.on('exit', () => { clearTimeout(timer); shares.delete(port); });
  shares.set(port, { child, dir, port, until: Date.now() + minutes * 60000 });
  return shareList();
}
function shareStop(port) { const s = shares.get(Number(port)); if (s) s.child.kill(); shares.delete(Number(port)); return shareList(); }
function shareList() {
  return [...shares.values()].map((s) => ({ dir: s.dir, port: s.port, until: s.until, urls: lanAddresses().map((a) => `http://${a.address}:${s.port}/`) }));
}

async function power(action) {
  if (!['poweroff', 'reboot'].includes(action)) throw new Error('bad action');
  const r = await priv('systemctl', [action]);
  if (!r.ok) throw new Error(r.stderr);
}

// The server runs as a system service; the browser must start inside the user's desktop session,
// so devos-session saves DISPLAY / XAUTHORITY / DBUS_SESSION_BUS_ADDRESS to ~/.devos/session.env.
function sessionEnv() {
  const env = { ...process.env };
  try {
    const f = path.join(process.env.DEVOS_DATA || path.join(os.homedir(), '.devos'), 'session.env');
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) { const m = /^([A-Z_]+)=(.*)$/.exec(line); if (m) env[m[1]] = m[2]; }
  } catch (_) { /* not in a desktop session */ }
  if (!env.XDG_RUNTIME_DIR && process.getuid) env.XDG_RUNTIME_DIR = `/run/user/${process.getuid()}`;   // WebKit needs it (a system service has none)
  env.WEBKIT_DISABLE_COMPOSITING_MODE = '1'; env.WEBKIT_DISABLE_DMABUF_RENDERER = '1';
  return env;
}
function openExternal(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs');
  const env = sessionEnv();
  if (!env.DISPLAY) throw new Error('No desktop session found (open the URL in your own browser)');
  const bin = fs.existsSync('/usr/local/bin/devos-browser') ? '/usr/local/bin/devos-browser' : 'xdg-open';
  const log = fs.openSync(path.join(process.env.DEVOS_DATA || os.tmpdir(), 'browser.log'), 'a');
  cp.spawn(bin, [url], { detached: true, stdio: ['ignore', log, log], env }).on('error', () => {}).unref();
}

function openApp(name) {
  const apps = { files: 'devos-files', terminal: 'devos-terminal', browser: 'devos-browser', ide: 'devos-app' };
  if (!apps[name]) throw new Error('Unknown app');
  const env = sessionEnv();
  if (!env.DISPLAY) throw new Error('No desktop session found - this works inside the DevOS ISO');
  const log = fs.openSync(path.join(process.env.DEVOS_DATA || os.tmpdir(), 'apps.log'), 'a');
  cp.spawn(apps[name], [], { detached: true, stdio: ['ignore', log, log], env }).on('error', () => {}).unref();
}

module.exports = { openApp, run, usbList, usbMount, usbEject, usbExport, wifiList, wifiConnect, shareStart, shareStop, shareList, power, openExternal, lanAddresses };
