#!/usr/bin/env node
/** Runs the transactional native-schema probe and validates its synthetic export against frozen v1. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { localWorkforceDatabase } from './local-target.mjs';
const tag = '[workforce:source-contract]';
const probe = readFileSync(new URL('../../supabase/tests/review_workforce_publisher.sql', import.meta.url), 'utf8');
const marker = 'WORKFORCE_SOURCE_EXPORT:';
const sql = probe.replace('ROLLBACK;', `SELECT '${marker}'||value::text FROM workforce_probe_results WHERE name='export';\nROLLBACK;`);
const env = process.env;
let command; let args;
if (env.WORKFORCE_PARITY_DB_URL) {
  const url = localWorkforceDatabase(env.WORKFORCE_PARITY_DB_URL);
  command = env.WORKFORCE_PARITY_PSQL || 'psql'; args = [url, '-v', 'ON_ERROR_STOP=1', '-qAt'];
} else if (env.WORKFORCE_PARITY_DOCKER_CONTAINER && env.WORKFORCE_PARITY_DOCKER_DB) {
  if (!/^haven-pg-verify-[a-z0-9-]+$/.test(env.WORKFORCE_PARITY_DOCKER_CONTAINER)) throw new Error('Synthetic workforce proof requires the migration runner container');
  command = 'docker'; args = ['exec', '-i', env.WORKFORCE_PARITY_DOCKER_CONTAINER, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', env.WORKFORCE_PARITY_DOCKER_DB, '-v', 'ON_ERROR_STOP=1', '-qAt'];
} else throw new Error('A local workforce source-contract database is required');
// A PGHOSTADDR/PGSERVICE inherited from an operator shell must not override the guarded URL.
const localEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('PG')));
const result = spawnSync(command, args, { env: localEnv, input: sql, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
// Do not print psql stdout: it can contain the synthetic roster in returned queue objects.
if (result.status !== 0) { console.error(`${tag} FAIL SQL probe (${result.status ?? 'transport'}): ${(result.stderr || '').split('\n').filter((line) => /ERROR:|CONTEXT:/.test(line)).slice(0, 4).join('\n')}`); process.exit(1); }
const exports = result.stdout.split('\n').filter((line) => line.startsWith(marker));
if (exports.length !== 1) throw new Error('Synthetic source proof returned no unique export');
const checked = spawnSync('deno', ['run', '--no-lock', '--config', 'supabase/functions/deno.json', 'scripts/workforce/validate-source.ts'], { input: exports[0].slice(marker.length), encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024 });
if (checked.status !== 0) { console.error(`${tag} FAIL workforce v1 validation (details contain stable validator codes only)`); console.error(checked.stderr); process.exit(1); }
process.stdout.write(checked.stdout);
