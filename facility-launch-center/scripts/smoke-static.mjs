import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function safePath(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/^\/+/, '');
  const target = resolve(join(root, clean || 'index.html'));
  if (!target.startsWith(root)) return null;
  return target;
}

const server = http.createServer(async (req, res) => {
  const target = safePath(req.url || '/');
  if (!target) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': mime[extname(target)] || 'application/octet-stream',
      'cache-control': target.endsWith('index.html') ? 'no-store' : 'no-cache'
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

try {
  const index = await fetch(`${base}/index.html`);
  if (!index.ok) throw new Error(`index.html returned ${index.status}`);
  const html = await index.text();
  for (const expected of ['/styles.css', '/src/app.js', 'noindex']) {
    if (!html.includes(expected)) throw new Error(`index.html missing ${expected}`);
  }

  const css = await fetch(`${base}/styles.css`);
  if (!css.ok) throw new Error(`styles.css returned ${css.status}`);

  const app = await fetch(`${base}/src/app.js`);
  if (!app.ok) throw new Error(`src/app.js returned ${app.status}`);
  const appJs = await app.text();
  for (const expected of ['./state.js', './scoring.js', './gates.js', './export.js']) {
    if (!appJs.includes(expected)) throw new Error(`app.js missing import ${expected}`);
  }

  const moduleFiles = ['state.js', 'scoring.js', 'gates.js', 'export.js', 'seedData.js', 'documentIntelligence.js', 'supabasePipeline.js', 'intakeCatalog.js'];
  for (const file of moduleFiles) {
    const response = await fetch(`${base}/src/${file}`);
    if (!response.ok) throw new Error(`src/${file} returned ${response.status}`);
  }

  console.log(`PASS static smoke: index/css/modules served over HTTP from ${base}`);
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}
