import { publishWorkforce, PublisherFailure, type PublisherStore } from './publisher.ts';
import type { WorkforceSource } from './contract/types.ts';
export async function handleWorkforcePublisher(request: Request, env: { cronSecret?: string; ingestSecret?: string }, store: () => PublisherStore, source: WorkforceSource, send: typeof fetch = fetch): Promise<Response> {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  if (!env.cronSecret || !env.ingestSecret) return json({ error: 'publisher_unconfigured' }, 503);
  const actual = new TextEncoder().encode(request.headers.get('x-cron-secret') ?? '');
  const expected = new TextEncoder().encode(env.cronSecret); let difference = actual.length ^ expected.length;
  for (let i = 0; i < Math.max(actual.length, expected.length); i++) difference |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
  if (difference !== 0) return json({ error: 'unauthorized' }, 401);
  // The caller cannot choose an organization, source row, destination or payload.
  const reader = request.body?.getReader(); let body = ''; let size = 0;
  if (reader) { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 2) { await reader.cancel(); return json({ error: 'body_not_allowed' }, 400); } body += new TextDecoder().decode(part.value); } }
  if (body !== '' && body !== '{}') return json({ error: 'body_not_allowed' }, 400);
  try { const result = await publishWorkforce(store(), source, env.ingestSecret, send); return json(result, result.outcome === 'busy' ? 202 : 200); }
  catch (error) { return json({ error: error instanceof PublisherFailure ? error.code : 'database_unavailable' }, 503); }
}
