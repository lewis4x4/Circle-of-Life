import { NextResponse } from 'next/server';
import { standUpCommand } from '@/lib/stand-up/server';

export const runtime = 'nodejs';
const ACTIONS = new Set(['workspace', 'save', 'roster', 'prefill', 'report', 'submitted_latest', 'export', 'revisions', 'post_submit_changes', 'preview_recovery', 'commit_recovery', 'stage_import', 'commit_import', 'reverse_import', 'set_entry_window', 'set_meeting_schedule']);

function trustedOrigin(origin: string, request: Request): boolean {
  // Netlify can expose an internal URL to the handler. Use deployment-owned
  // addresses, never client-supplied Host or forwarded headers, in production.
  const origins = new Set(['https://circleoflifealf.com', 'https://www.circleoflifealf.com']);
  for (const configured of [process.env.NEXT_PUBLIC_SITE_URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL]) {
    if (!configured) continue;
    try {
      const url = new URL(configured);
      if (url.protocol === 'https:' && !url.username && !url.password) origins.add(url.origin);
    } catch { /* Invalid deployment configuration grants no additional origin. */ }
  }
  if (process.env.NODE_ENV !== 'production') origins.add(new URL(request.url).origin);
  return origins.has(origin);
}

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && !trustedOrigin(origin, request)) return NextResponse.json({ error: 'Cross-origin operation denied.' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
  try {
    const raw = await request.text();
    if (raw.length > 1000000) return NextResponse.json({ error: 'Upload exceeds the 1 MB pilot limit. Split historical imports into smaller batches.' }, { status: 413 });
    const body = JSON.parse(raw);
    if (!ACTIONS.has(body.action) || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) return NextResponse.json({ error: 'Invalid Stand Up command.' }, { status: 400 });
    const result = await standUpCommand(body.action, body.payload);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stand Up operation failed.';
    const detail = (error ?? {}) as { code?: unknown; hint?: unknown };
    const code = typeof detail.code === 'string' ? detail.code : undefined;
    // A refusal the caller has to branch on carries its own code beside the
    // sentence: the entry window is not open yet (P0409), not a stale version.
    const refusal = typeof detail.hint === 'string' && detail.hint ? detail.hint : undefined;
    const status = message === 'Authentication required' ? 401 : code === '42501' ? 403 : code === 'P0409' || /version|conflict/i.test(message) ? 409 : 400;
    return NextResponse.json(refusal ? { error: message, code: refusal } : { error: message }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
