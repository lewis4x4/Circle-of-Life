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
const cacheToken = '20260514-flc-push-hardened';

try {
  const index = await fetch(`${base}/index.html`);
  if (!index.ok) throw new Error(`index.html returned ${index.status}`);
  const html = await index.text();
  for (const expected of [`/styles.css?v=${cacheToken}`, `/dist/app.bundle.js?v=${cacheToken}`, 'noindex']) {
    if (!html.includes(expected)) throw new Error(`index.html missing ${expected}`);
  }

  const css = await fetch(`${base}/styles.css`);
  if (!css.ok) throw new Error(`styles.css returned ${css.status}`);

  const headers = await readFile(join(root, '_headers'), 'utf8');
  if (!/\/dist\/\*\s+Cache-Control: no-cache, must-revalidate/.test(headers)) {
    throw new Error('_headers missing no-cache rule for /dist/*');
  }

  const app = await fetch(`${base}/dist/app.bundle.js`);
  if (!app.ok) throw new Error(`dist/app.bundle.js returned ${app.status}`);
  const appJs = await app.text();
  for (const expected of ['Push to Haven (Capture + Promote)', 'pushAndPromoteStateToHaven', 'Step 2 — Promoted to live Haven app', '../data/homewood-round1-state.json']) {
    if (!appJs.includes(expected)) throw new Error(`app.bundle.js missing marker ${expected}`);
  }
  if (/from\s+["']\.\//.test(appJs)) throw new Error('app.bundle.js still contains unresolved source imports');

  const repoRootCandidates = [
    resolve(root, '..'),
    resolve(root, '../..')
  ];
  let nextFacilityLaunchPage = '';
  let nextFacilityLaunchPagePath = '';
  for (const candidate of repoRootCandidates) {
    try {
      nextFacilityLaunchPagePath = join(candidate, 'src/app/facility-launch/page.tsx');
      nextFacilityLaunchPage = await readFile(nextFacilityLaunchPagePath, 'utf8');
      break;
    } catch (error) {
      if (candidate === repoRootCandidates.at(-1)) throw error;
    }
  }
  for (const expected of [`/facility-launch-static/styles.css?v=${cacheToken}`, `/facility-launch-static/dist/app.bundle.js?v=${cacheToken}`]) {
    if (!nextFacilityLaunchPage.includes(expected)) throw new Error(`${nextFacilityLaunchPagePath} missing ${expected}`);
  }

  const round1State = await fetch(`${base}/data/homewood-round1-state.json`);
  if (!round1State.ok) throw new Error(`data/homewood-round1-state.json returned ${round1State.status}`);
  const round1Json = await round1State.json();
  if ((round1Json.mvpData?.M3?.rooms || []).length !== 20) throw new Error('Round 1 state JSON missing 20-room model');

  const moduleFiles = ['state.js', 'scoring.js', 'gates.js', 'export.js', 'seedData.js', 'documentIntelligence.js', 'supabasePipeline.js', 'intakeCatalog.js'];
  for (const file of moduleFiles) {
    const response = await fetch(`${base}/src/${file}`);
    if (!response.ok) throw new Error(`src/${file} returned ${response.status}`);
    if (file === 'supabasePipeline.js') {
      const pipelineJs = await response.text();
      for (const expected of ['facility-launch-import', 'facility-launch-promote', 'pushAndPromoteStateToHaven']) {
        if (!pipelineJs.includes(expected)) throw new Error(`supabasePipeline.js missing ${expected}`);
      }
    }
  }

  const pipelineModule = await import(new URL('../src/supabasePipeline.js', import.meta.url));
  const testConfig = {
    supabaseUrl: 'https://example.supabase.co',
    anonKey: 'anon',
    accessToken: 'jwt',
    organizationId: '00000000-0000-0000-0000-000000000001',
    facilityId: '00000000-0000-0000-0002-000000000003'
  };
  const originalFetch = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), body: JSON.parse(init.body || '{}') });
      const functionName = String(url).split('/').pop();
      const payload = functionName === 'facility-launch-import'
        ? { mode: init.body?.includes('"dry_run":true') ? 'dry_run' : 'apply', inserts: 1, updates: 0, noops: 0, payload_count: 1, rows: [], gap_report: [] }
        : { mode: 'apply', summary: 'Apply recorded 1 module(s); 0 not implemented, 0 failed, 0 gap module(s).', modules_promoted: [], gap_modules: [] };
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const applied = await pipelineModule.pushAndPromoteStateToHaven({ mvpData: { M1: { dba: 'Homewood' } } }, { dryRun: false }, testConfig);
    if (calls.length !== 2) throw new Error(`apply push expected 2 edge calls, got ${calls.length}`);
    if (!calls[0].url.endsWith('/facility-launch-import') || !calls[1].url.endsWith('/facility-launch-promote')) throw new Error('apply push did not call import before promote');
    if (calls[0].body.dry_run !== false || calls[1].body.dry_run !== false) throw new Error('apply push did not pass dry_run=false to both functions');
    if (!applied.captured || !applied.promoted) throw new Error('apply push did not return captured + promoted sections');

    calls.length = 0;
    const preview = await pipelineModule.pushAndPromoteStateToHaven({ mvpData: { M1: { dba: 'Homewood' } } }, { dryRun: true }, testConfig);
    if (calls.length !== 1 || !calls[0].url.endsWith('/facility-launch-import')) throw new Error('dry-run should preview capture only to avoid stale promotion data');
    if (calls[0].body.dry_run !== true || preview.promoted?.modules_promoted?.length !== 0) throw new Error('dry-run did not preserve no-write capture-only behavior');

    calls.length = 0;
    globalThis.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), body: JSON.parse(init.body || '{}') });
      if (String(url).endsWith('/facility-launch-promote')) {
        return new Response(JSON.stringify({ error: 'promotion exploded' }), { status: 500, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ mode: 'apply', inserts: 1, updates: 0, noops: 0, payload_count: 1, rows: [], gap_report: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const partial = await pipelineModule.pushAndPromoteStateToHaven({ mvpData: { M1: { dba: 'Homewood' } } }, { dryRun: false }, testConfig);
    if (partial.mode !== 'partial' || !partial.captured || !partial.promoted?.error?.includes('promotion exploded')) {
      throw new Error('promotion failure did not preserve successful capture context');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(`PASS static smoke: index/css/bundle served over HTTP from ${base}`);
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}
