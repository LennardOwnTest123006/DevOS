'use strict';
// Copies the front-end libraries out of node_modules into public/vendor so the
// OS works fully offline (no CDN is ever used at runtime).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'public', 'vendor');

function copy(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}
if (!fs.existsSync(nm)) {
  console.error('node_modules missing - run "npm install" first');
  process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });
copy(path.join(nm, 'monaco-editor', 'min', 'vs'), path.join(out, 'monaco', 'vs'));
copy(path.join(nm, '@xterm', 'xterm', 'lib', 'xterm.js'), path.join(out, 'xterm', 'xterm.js'));
copy(path.join(nm, '@xterm', 'xterm', 'css', 'xterm.css'), path.join(out, 'xterm', 'xterm.css'));
copy(path.join(nm, '@xterm', 'addon-fit', 'lib', 'addon-fit.js'), path.join(out, 'xterm', 'addon-fit.js'));
copy(path.join(nm, '@xterm', 'addon-web-links', 'lib', 'addon-web-links.js'), path.join(out, 'xterm', 'addon-web-links.js'));
console.log('vendor ready ->', out);
