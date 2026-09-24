import { PublisherFailure, type Fence, type Lease, type Pending, type PublisherStore } from './publisher.ts';
import type { WorkforceRecords } from './contract/types.ts';

export function publisherStore(url: string, serviceKey: string, send: typeof fetch = fetch): PublisherStore {
  async function isExportOversized(response: Response): Promise<boolean> {
    const reader = response.body?.getReader(); if (!reader) return false;
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 4096) { await reader.cancel(); return false; } chunks.push(part.value); }
      const raw = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.byteLength; }
      const error = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      // Recognize only the two source-owned constant errors. Never expose native
      // details, hints, arbitrary database messages or a receiver error body.
      return error?.code === '22023' && ['workforce_export_oversized', 'Roster exceeds single-snapshot limits'].includes(error.message);
    } catch { return false; }
  }
  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    try {
      const response = await send(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', apikey: serviceKey, authorization: `Bearer ${serviceKey}` }, body: JSON.stringify(args), redirect: 'error', signal: AbortSignal.timeout(30_000) });
      if (!response.ok) {
        if (name === 'workforce_publisher_export' && await isExportOversized(response)) throw new PublisherFailure('oversized_snapshot');
        if (!response.bodyUsed) await response.body?.cancel();
        throw new PublisherFailure('database_unavailable');
      }
      return await response.json() as T;
    } catch (error) { throw error instanceof PublisherFailure ? error : new PublisherFailure('database_unavailable'); }
  }
  const fenceArgs = (fence: Fence) => ({ p_run_id: fence.run_id, p_lease_token: fence.lease_token, p_generation: fence.generation });
  return {
    acquire: (id) => rpc<Lease>('workforce_publisher_acquire', { p_run_id: id, p_lease_seconds: 120 }),
    export: (fence) => rpc<{ source_as_of: string; records: WorkforceRecords }>('workforce_publisher_export', fenceArgs(fence)),
    storePending: (fence, body, hash) => rpc<Pending>('workforce_publisher_store_pending', { ...fenceArgs(fence), p_body: body, p_body_sha256: hash }),
    complete: async (fence, receipt) => { await rpc('workforce_publisher_complete', { ...fenceArgs(fence), p_receipt_id: receipt.receipt_id, p_received_at: receipt.received_at, p_replayed: receipt.replayed, p_body_sha256: receipt.body_sha256 }); },
    release: async (fence, outcome, code) => { await rpc('workforce_publisher_release', { ...fenceArgs(fence), p_outcome: outcome, p_error_code: code }); },
  };
}
