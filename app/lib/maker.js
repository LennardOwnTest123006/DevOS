'use strict';
// Custom Maker: project templates (built in + your own) and scaffolding.
const fs = require('fs');
const path = require('path');
const os = require('os');

const T = (id, name, lang, desc, run, files) => ({ id, name, lang, desc, run, files });

const BUILTIN = [
  T('web', 'Website (HTML + CSS + JS)', 'html', 'Static site with live preview', '@preview index.html', {
    'index.html': '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width,initial-scale=1">\n  <title>{{name}}</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>{{name}}</h1>\n  <button id="btn">Click me</button>\n  <script src="script.js"></script>\n</body>\n</html>\n',
    'style.css': 'body { font-family: system-ui, sans-serif; margin: 2rem; }\nbutton { padding: .5rem 1rem; }\n',
    'script.js': "document.getElementById('btn').addEventListener('click', () => alert('Hello from {{name}}'));\n",
  }),
  T('node', 'Node.js app', 'javascript', 'package.json + index.js', 'node index.js', {
    'package.json': '{\n  "name": "{{name}}",\n  "version": "1.0.0",\n  "main": "index.js",\n  "scripts": { "start": "node index.js" }\n}\n',
    'index.js': "console.log('Hello from {{name}} on Node', process.version);\n",
  }),
  T('node-http', 'Node.js HTTP server', 'javascript', 'Tiny web server on :3000', 'node server.js', {
    'server.js': "const http = require('http');\nhttp.createServer((req, res) => {\n  res.setHeader('content-type', 'text/plain');\n  res.end('Hello from {{name}}\\n');\n}).listen(3000, () => console.log('http://localhost:3000'));\n",
  }),
  T('typescript', 'TypeScript', 'typescript', 'tsx + tsconfig', 'tsx src/index.ts', {
    'tsconfig.json': '{\n  "compilerOptions": { "target": "ES2022", "module": "commonjs", "strict": true, "outDir": "dist" },\n  "include": ["src"]\n}\n',
    'src/index.ts': "const greet = (who: string): string => `Hello, ${who}!`;\nconsole.log(greet('{{name}}'));\n",
  }),
  T('python', 'Python', 'python', 'Script with main()', 'python3 -u main.py', {
    'main.py': 'def main() -> None:\n    print("Hello from {{name}}")\n\n\nif __name__ == "__main__":\n    main()\n',
  }),
  T('python-web', 'Python web server', 'python', 'Standard-library HTTP server on :8000', 'python3 -u app.py', {
    'app.py': 'from http.server import BaseHTTPRequestHandler, HTTPServer\n\n\nclass H(BaseHTTPRequestHandler):\n    def do_GET(self):\n        self.send_response(200)\n        self.send_header("content-type", "text/plain")\n        self.end_headers()\n        self.wfile.write(b"Hello from {{name}}\\n")\n\n\nprint("http://localhost:8000")\nHTTPServer(("127.0.0.1", 8000), H).serve_forever()\n',
  }),
  T('c', 'C (Makefile)', 'c', 'gcc + make', 'make run', {
    'main.c': '#include <stdio.h>\n\nint main(void) {\n    printf("Hello from {{name}}\\n");\n    return 0;\n}\n',
    'Makefile': 'CC=gcc\nCFLAGS=-Wall -Wextra -g\n\napp: main.c\n\t$(CC) $(CFLAGS) main.c -o app\n\nrun: app\n\t./app\n\nclean:\n\trm -f app\n',
  }),
  T('cpp', 'C++ (Makefile)', 'cpp', 'g++ -std=c++20 + make', 'make run', {
    'main.cpp': '#include <iostream>\n\nint main() {\n    std::cout << "Hello from {{name}}\\n";\n}\n',
    'Makefile': 'CXX=g++\nCXXFLAGS=-std=c++20 -Wall -Wextra -g\n\napp: main.cpp\n\t$(CXX) $(CXXFLAGS) main.cpp -o app\n\nrun: app\n\t./app\n\nclean:\n\trm -f app\n',
  }),
  T('java', 'Java', 'java', 'Single-file Java', 'java Main.java', {
    'Main.java': 'public class Main {\n    public static void main(String[] args) {\n        System.out.println("Hello from {{name}}");\n    }\n}\n',
  }),
  T('go', 'Go', 'go', 'go.mod + main.go', 'go run .', {
    'go.mod': 'module {{name}}\n\ngo 1.21\n',
    'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello from {{name}}")\n}\n',
  }),
  T('rust', 'Rust (Cargo)', 'rust', 'cargo project', 'cargo run', {
    'Cargo.toml': '[package]\nname = "{{name}}"\nversion = "0.1.0"\nedition = "2021"\n',
    'src/main.rs': 'fn main() {\n    println!("Hello from {{name}}");\n}\n',
  }),
  T('php', 'PHP', 'php', 'index.php', 'php index.php', { 'index.php': '<?php\necho "Hello from {{name}}\\n";\n' }),
  T('ruby', 'Ruby', 'ruby', 'main.rb', 'ruby main.rb', { 'main.rb': 'puts "Hello from {{name}}"\n' }),
  T('lua', 'Lua', 'lua', 'main.lua', 'lua5.4 main.lua', { 'main.lua': 'print("Hello from {{name}}")\n' }),
  T('bash', 'Shell script', 'shell', 'run.sh', 'bash run.sh', { 'run.sh': '#!/usr/bin/env bash\nset -euo pipefail\necho "Hello from {{name}}"\n' }),
];

const userDir = () => path.join(process.env.DEVOS_DATA || path.join(os.homedir(), '.devos'), 'templates');

function userTemplates() {
  const d = userDir();
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(d, e.name, '.devos.json'), 'utf8')); } catch (_) { /* optional */ }
    return { id: 'user:' + e.name, name: e.name, lang: meta.lang || 'plaintext', desc: 'Your template', run: meta.run || '', user: true };
  });
}

const list = () => [...BUILTIN.map(({ files, ...t }) => t), ...userTemplates()];

function safeName(n) {
  if (!/^[A-Za-z0-9._-][A-Za-z0-9._ -]{0,63}$/.test(n || '') || n.includes('..')) throw new Error('Invalid project name (letters, digits, . _ - and space)');
  return n;
}

function copyTree(src, dst, name) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d, name);
    else if (e.isFile()) {
      const buf = fs.readFileSync(s);
      fs.writeFileSync(d, buf.includes(0) ? buf : buf.toString('utf8').replaceAll('{{name}}', name), { mode: fs.statSync(s).mode });
    }
  }
}

function create({ template, name, parent }) {
  safeName(name);
  const dir = path.join(parent, name);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error('Folder already exists and is not empty');
  let run = '';
  if (template.startsWith('user:')) {
    const src = path.join(userDir(), safeName(template.slice(5)));
    copyTree(src, dir, name);
    try { run = JSON.parse(fs.readFileSync(path.join(src, '.devos.json'), 'utf8')).run || ''; } catch (_) { /* optional */ }
  } else {
    const t = BUILTIN.find((x) => x.id === template);
    if (!t) throw new Error('Unknown template');
    fs.mkdirSync(dir, { recursive: true });
    for (const [f, content] of Object.entries(t.files)) {
      const p = path.join(dir, f);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content.replaceAll('{{name}}', name));
    }
    fs.writeFileSync(path.join(dir, '.devos.json'), JSON.stringify({ lang: t.lang, run: t.run }, null, 2) + '\n');
    run = t.run;
  }
  return { dir, run };
}

function saveAsTemplate({ dir, name }) {
  safeName(name);
  const dst = path.join(userDir(), name);
  fs.rmSync(dst, { recursive: true, force: true });
  const skip = new Set(['node_modules', '.git', 'target', 'dist', '__pycache__']);
  (function cp(s, d) {
    fs.mkdirSync(d, { recursive: true });
    for (const e of fs.readdirSync(s, { withFileTypes: true })) {
      if (skip.has(e.name) || e.name.endsWith('.out')) continue;
      if (e.isDirectory()) cp(path.join(s, e.name), path.join(d, e.name));
      else if (e.isFile()) fs.copyFileSync(path.join(s, e.name), path.join(d, e.name));
    }
  })(dir, dst);
  return { template: 'user:' + name };
}

function deleteTemplate(id) {
  if (!id.startsWith('user:')) throw new Error('Built-in templates cannot be deleted');
  fs.rmSync(path.join(userDir(), safeName(id.slice(5))), { recursive: true, force: true });
}

module.exports = { list, create, saveAsTemplate, deleteTemplate };
