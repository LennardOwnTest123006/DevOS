'use strict';
// Checks unsaved editor text with the real compiler/interpreter and returns
// editor markers (the red/yellow underlines). Code is passed through a temp file.
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const LANGS = require('./languages');

const byId = Object.fromEntries(LANGS.map((l) => [l.id, l]));

function parse(kind, out, base) {
  const markers = [];
  const push = (line, col, sev, msg) =>
    markers.push({ line: Math.max(1, line | 0), col: Math.max(1, col | 0), severity: sev, message: msg.trim() });
  const lines = out.split(/\r?\n/);
  if (kind === 'gcc') {
    const re = /^(.+?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note)?:?\s*(.*)$/;
    for (const ln of lines) {
      const m = re.exec(ln);
      if (!m || !m[5] || m[4] === 'note') continue;
      if (m[1].includes('/usr/') || m[1].includes('<')) continue;
      if (path.basename(m[1]) !== base && !m[1].startsWith('<')) continue;
      push(+m[2], +(m[3] || 1), m[4] === 'warning' ? 'warning' : 'error', m[5]);
    }
  } else if (kind === 'python') {
    const re = /^.+?:(\d+):(\d+): error: (.*)$/;
    for (const ln of lines) { const m = re.exec(ln); if (m) push(+m[1], +m[2], 'error', m[3]); }
  } else if (kind === 'node') {
    const m1 = /^.+?:(\d+)\s*$/m.exec(out);
    const err = /^(\w*Error: .*)$/m.exec(out);
    const caret = lines.findIndex((l) => /^\s*\^+\s*$/.test(l));
    if (m1 && err) push(+m1[1], caret >= 0 ? lines[caret].indexOf('^') + 1 : 1, 'error', err[1]);
  } else if (kind === 'php') {
    const m = /(?:Parse|Fatal) error:\s+(.*) in .* on line (\d+)/.exec(out);
    if (m) push(+m[2], 1, 'error', m[1]);
  } else if (kind === 'perl') {
    const m = /^(.*) at .* line (\d+)/m.exec(out);
    if (m && !/syntax OK/.test(out)) push(+m[2], 1, 'error', m[1]);
  } else if (kind === 'bash') {
    const m = /line (\d+): (.*)/.exec(out);
    if (m) push(+m[1], 1, 'error', m[2]);
  } else if (kind === 'lineonly') {
    const m = /:(\d+):\s*(.*)/.exec(out);
    if (m) push(+m[1], 1, 'error', m[2]);
  }
  return markers;
}

function which(bin) {
  const dirs = (process.env.PATH || '').split(path.delimiter);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  return dirs.some((d) => exts.some((e) => fs.existsSync(path.join(d, bin + e))));
}

function checkCode({ langId, code, filePath }) {
  const lang = byId[langId];
  if (!lang || !lang.check || !lang.check.cmd) return Promise.resolve({ markers: [], skipped: 'monaco-or-none' });
  const spec = lang.check;
  if (!which(spec.cmd[0])) return Promise.resolve({ markers: [], unavailable: spec.cmd[0] });
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'devos-chk-'));
  const base = path.basename(filePath || 'untitled.' + lang.exts[0]);
  const tmp = path.join(tmpdir, base);
  fs.writeFileSync(tmp, code);
  const dir = filePath ? path.dirname(filePath) : os.homedir();
  const sub = (a) => a.replace('{tmp}', tmp).replace('{tmpdir}', tmpdir).replace('{dir}', dir)
    .replace('{checkpy}', path.join(__dirname, 'check.py')).replace('{yamlpy}', path.join(__dirname, 'check_yaml.py'));
  const args = spec.cmd.slice(1).map(sub);
  return new Promise((resolve) => {
    cp.execFile(spec.cmd[0], args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024, cwd: tmpdir }, (err, stdout, stderr) => {
      fs.rmSync(tmpdir, { recursive: true, force: true });
      const out = (spec.stdoutNull ? '' : stdout) + '\n' + stderr;
      resolve({ markers: parse(spec.parser, out.replaceAll(tmpdir + path.sep, ''), base).map((m) => m), exit: err ? err.code : 0 });
    });
  });
}

module.exports = { checkCode, which };
