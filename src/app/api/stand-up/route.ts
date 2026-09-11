import { NextResponse } from 'next/server';
import { standUpCommand } from '@/lib/stand-up/server';

export const runtime = 'nodejs';
const ACTIONS = new Set(['workspace', 'save', 'export', 'preview_recovery', 'commit_recovery', 'stage_import', 'commit_import', 'reverse_import']);
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: 'Cross-origin operation denied.' }, { status: 403 });
  try {
    const raw = await request.text();
    if (raw.length > 1000000) return NextResponse.json({ error: 'Upload exceeds the 1 MB pilot limit. Split historical imports into smaller batches.' }, { status: 413 });
    const body = JSON.parse(raw);
    if (!ACTIONS.has(body.action) || !body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) return NextResponse.json({ error: 'Invalid Stand Up command.' }, { status: 400 });
    const result = await standUpCommand(body.action, body.payload);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Stand Up operation failed.';
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    const status = message === 'Authentication required' ? 401 : code === '42501' ? 403 : /version|conflict/i.test(message) ? 409 : 400;
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
