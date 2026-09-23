import { signWorkforceBytes, validateWorkforceRecords, validateWorkforceRequest, workforceCounts, workforcePayloadHash, workforceSha256, WORKFORCE_MAX_BYTES } from './contract/protocol.ts';
import type { WorkforceRecords, WorkforceSnapshot, WorkforceSource } from './contract/types.ts';

export const WORKFORCE_DESTINATION = 'https://wecsjfiituxlityaacba.supabase.co/functions/v1/workforce-ingest';
export type Pending = { body: string; body_sha256: string; batch_id: string; sequence: number; source_as_of: string };
export type Lease = { acquired: boolean; reason?: string; organization_id?: string; key_id?: string; destination_url?: string; generation?: number; lease_token?: string; sequence?: number; pending?: Pending | null };
export type Fence = { run_id: string; lease_token: string; generation: number };
export interface PublisherStore {
  acquire(runId: string): Promise<Lease>;
  export(fence: Fence): Promise<{ source_as_of: string; records: WorkforceRecords }>;
  storePending(fence: Fence, body: string, hash: string): Promise<Pending>;
  complete(fence: Fence, receipt: { receipt_id: string; received_at: string; replayed: boolean; body_sha256: string }): Promise<void>;
  release(fence: Fence, outcome: string, errorCode: string | null): Promise<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
export class PublisherFailure extends Error {
  constructor(public code: 'publisher_unconfigured' | 'database_unavailable' | 'invalid_source_records' | 'invalid_pending' | 'oversized_snapshot' | 'destination_unavailable' | 'destination_rejected' | 'invalid_receipt') { super(code); }
}
export async function publishWorkforce(store: PublisherStore, source: WorkforceSource, secret: string, send: typeof fetch = fetch, now = Date.now): Promise<Record<string, unknown>> {
  if (new TextEncoder().encode(secret).length < 32) throw new PublisherFailure('publisher_unconfigured');
  const runId = crypto.randomUUID();
  const lease = await store.acquire(runId);
  if (!lease.acquired) {
    if (lease.reason === 'disabled' || lease.reason === 'busy') return { outcome: lease.reason };
    throw new PublisherFailure('publisher_unconfigured');
  }
  const fence = { run_id: runId, lease_token: lease.lease_token ?? '', generation: lease.generation ?? 0 };
  try {
    if (!uuid.test(fence.lease_token) || !Number.isSafeInteger(fence.generation) || fence.generation < 1 || !uuid.test(lease.organization_id ?? '') || !/^[a-zA-Z0-9_-]{1,64}$/.test(lease.key_id ?? '') || lease.destination_url !== WORKFORCE_DESTINATION || !Number.isSafeInteger(lease.sequence) || lease.sequence! < 0 || lease.sequence! >= Number.MAX_SAFE_INTEGER) throw new PublisherFailure('publisher_unconfigured');
    let pending = lease.pending;
    if (!pending) {
      const exported = await store.export(fence);
      if (!timestamp(exported.source_as_of) || Date.parse(exported.source_as_of) > now() + 300_000) throw new PublisherFailure('invalid_source_records');
      try { validateWorkforceRecords(exported.records, source, now()); } catch { throw new PublisherFailure('invalid_source_records'); }
      const snapshot: WorkforceSnapshot = { source_system: source, source_tenant_id: lease.organization_id!, dataset: 'workforce_roster', contract_version: 1, batch_id: crypto.randomUUID(), sequence: lease.sequence! + 1, source_as_of: exported.source_as_of, mode: 'full', complete: true, counts: workforceCounts(exported.records), payload_sha256: await workforcePayloadHash(exported.records), records: exported.records };
      const body = JSON.stringify(snapshot);
      const bytes = new TextEncoder().encode(body);
      if (bytes.length > WORKFORCE_MAX_BYTES) throw new PublisherFailure('oversized_snapshot');
      pending = await store.storePending(fence, body, await workforceSha256(bytes));
    }
    const bytes = new TextEncoder().encode(pending.body);
    if (bytes.length > WORKFORCE_MAX_BYTES || await workforceSha256(bytes) !== pending.body_sha256 || pending.sequence !== lease.sequence! + 1 || !uuid.test(pending.batch_id)) throw new PublisherFailure('invalid_pending');
    let snapshot: WorkforceSnapshot;
    try { snapshot = JSON.parse(pending.body); } catch { throw new PublisherFailure('invalid_pending'); }
    if (snapshot.source_system !== source || snapshot.source_tenant_id !== lease.organization_id || snapshot.dataset !== 'workforce_roster' || snapshot.contract_version !== 1 || snapshot.batch_id !== pending.batch_id || snapshot.sequence !== pending.sequence || snapshot.source_as_of !== pending.source_as_of || snapshot.complete !== true || snapshot.mode !== 'full') throw new PublisherFailure('invalid_pending');
    const sentAt = String(Math.floor(now() / 1000));
    const contract = { key_id: lease.key_id!, source_system: source, source_tenant_id: lease.organization_id!, dataset: 'workforce_roster' as const, enabled: true };
    const signature = await signWorkforceBytes(secret, contract, sentAt, bytes);
    const headers = new Headers({ 'content-type': 'application/json', 'x-workforce-key-id': contract.key_id, 'x-workforce-sent-at': sentAt, 'x-workforce-signature': signature });
    // Revalidate persisted bytes too: no obsolete/corrupt pending record can add
    // a forbidden field or change source scope merely because it has a hash.
    try { await validateWorkforceRequest({ method: 'POST', headers, raw: bytes, contract, secret, now: now() }); }
    catch { throw new PublisherFailure('invalid_pending'); }
    let response: Response;
    try { response = await send(WORKFORCE_DESTINATION, { method: 'POST', headers, body: bytes, redirect: 'error', signal: AbortSignal.timeout(30_000) }); }
    catch { throw new PublisherFailure('destination_unavailable'); }
    if (response.status !== 200) { await response.body?.cancel(); throw new PublisherFailure('destination_rejected'); }
    // Successful receipt is tiny. Never read/log an unbounded or sensitive response body.
    const reader = response.body?.getReader(); let raw = ''; let size = 0;
    if (reader) { const decoder = new TextDecoder('utf-8', { fatal: true }); try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 4096) { await reader.cancel(); throw new PublisherFailure('invalid_receipt'); } raw += decoder.decode(part.value, { stream: true }); } raw += decoder.decode(); } catch { throw new PublisherFailure('invalid_receipt'); } }
    let receipt: Record<string, unknown>;
    try { receipt = JSON.parse(raw); } catch { throw new PublisherFailure('invalid_receipt'); }
    if (!receipt || typeof receipt !== 'object' || !uuid.test(String(receipt.receipt_id ?? '')) || !uuid.test(String(receipt.source_id ?? '')) || receipt.batch_id !== pending.batch_id || receipt.sequence !== pending.sequence || receipt.body_sha256 !== pending.body_sha256 || receipt.source_as_of !== pending.source_as_of || !timestamp(receipt.received_at) || typeof receipt.replayed !== 'boolean') throw new PublisherFailure('invalid_receipt');
    await store.complete(fence, { receipt_id: receipt.receipt_id as string, received_at: receipt.received_at, replayed: receipt.replayed, body_sha256: pending.body_sha256 });
    return { outcome: 'published', batch_id: pending.batch_id, sequence: pending.sequence, receipt_id: receipt.receipt_id, replayed: receipt.replayed };
  } catch (error) {
    const safe = error instanceof PublisherFailure ? error : new PublisherFailure('database_unavailable');
    try { await store.release(fence, 'failed', safe.code); } catch { /* The fenced lease expires; durable pending bytes remain. */ }
    throw safe;
  }
}
