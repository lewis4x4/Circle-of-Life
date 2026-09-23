import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** libpq query parameters can override the URL authority; validate the effective target. */
export function localWorkforceDatabase(input) {
  const url = new URL(input);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hash || url.username !== 'postgres' || url.password) throw new Error('Synthetic workforce proof requires a local postgres verification URL');
  if (!/^\/(haven_verify_|col721_haven_)[a-z0-9_]+$/.test(url.pathname)) throw new Error('Synthetic workforce proof requires its named isolated database');
  const query = [...url.searchParams.keys()];
  if (query.some((key) => !['host', 'port'].includes(key)) || new Set(query).size !== query.length) throw new Error('Unsupported database connection override');
  const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'];
  if (url.hostname && !loopback.includes(url.hostname)) throw new Error('Synthetic workforce proof requires a local database');
  const effectiveHost = url.searchParams.get('host') ?? url.hostname;
  if (!effectiveHost) throw new Error('An explicit local database host is required');
  if (!loopback.includes(effectiveHost)) {
    if (!path.isAbsolute(effectiveHost)) throw new Error('Database host must be loopback or an owned socket');
    const root = realpathSync(path.join(homedir(), '.hermes', 'tmp', 'agent-runs'));
    const socket = realpathSync(effectiveHost);
    if (!socket.startsWith(`${root}${path.sep}`)) throw new Error('Database socket is outside the run-owned directory');
    const manifest = JSON.parse(readFileSync(path.join(socket, 'manifest.json'), 'utf8'));
    if (manifest.created_by !== 'codex' || manifest.run_id !== path.basename(socket)) throw new Error('Database socket has no matching run ownership');
  }
  const port = url.searchParams.get('port') ?? url.port;
  if (!port || !/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('An explicit local verification port is required');
  return url.href;
}
