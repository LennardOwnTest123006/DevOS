'use strict';
const cp = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');

function pickShell() {
  if (process.platform === 'win32') return process.env.COMSPEC || 'powershell.exe';
  const s = process.env.SHELL;
  if (s && fs.existsSync(s)) return s;
  return fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
}

// Real PTY on Linux/macOS (through python3), plain pipes as a fallback.
function createPty({ cwd, cols = 80, rows = 24, env = {} }) {
  const shell = pickShell();
  const home = os.homedir();
  const dir = cwd && fs.existsSync(cwd) ? cwd : home;
  const fullEnv = { ...process.env, ...env, TERM: 'xterm-256color' };
  let child;
  let ctl = null;
  if (process.platform !== 'win32') {
    child = cp.spawn(
      'python3',
      ['-I', path.join(__dirname, 'pty_helper.py'), shell, dir, String(cols), String(rows)],
      { stdio: ['pipe', 'pipe', 'inherit', 'pipe'], env: fullEnv }
    );
    ctl = child.stdio[3];
    ctl.on('error', () => {});
  } else {
    child = cp.spawn(shell, [], { cwd: dir, env: fullEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.on('data', (d) => child.stdout.emit('data', d));
  }
  child.stdin.on('error', () => {});
  return {
    onData: (fn) => child.stdout.on('data', fn),
    onExit: (fn) => child.on('exit', fn),
    write: (d) => child.stdin.writable && child.stdin.write(d),
    resize: (c, r) => ctl && ctl.writable && ctl.write(`R ${c | 0} ${r | 0}\n`),
    kill: () => { try { child.kill('SIGHUP'); } catch (_) { /* gone */ } },
  };
}

module.exports = { createPty };
