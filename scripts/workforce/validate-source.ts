/** Accept only the synthetic local SQL-probe export on stdin; never write roster bodies. */
import { signWorkforceBytes, validateWorkforceRequest, workforceCounts, workforcePayloadHash } from '../../supabase/functions/workforce-publisher/contract/protocol.ts';
import type { WorkforceRecords, WorkforceSnapshot } from '../../supabase/functions/workforce-publisher/contract/types.ts';
const raw = await new Response(Deno.stdin.readable).text();
const observed = JSON.parse(raw) as { source_as_of: string; records: WorkforceRecords };
const snapshot: WorkforceSnapshot = {
  source_system: 'haven', source_tenant_id: '72100000-0000-4000-8000-000000000001', dataset: 'workforce_roster', contract_version: 1,
  batch_id: '72100000-0000-4000-8000-000000000031', sequence: 1, source_as_of: observed.source_as_of, mode: 'full', complete: true,
  counts: workforceCounts(observed.records), payload_sha256: await workforcePayloadHash(observed.records), records: observed.records,
};
const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
const contract = { key_id: 'synthetic-workforce', source_system: 'haven' as const, source_tenant_id: snapshot.source_tenant_id, dataset: 'workforce_roster' as const, enabled: true };
const secret = 'synthetic-conformance-key-not-a-real-secret';
const sentAt = String(Math.floor(Date.now() / 1000));
const headers = new Headers({ 'content-type': 'application/json', 'x-workforce-key-id': contract.key_id, 'x-workforce-sent-at': sentAt,
  'x-workforce-signature': await signWorkforceBytes(secret, contract, sentAt, bytes) });
await validateWorkforceRequest({ method: 'POST', headers, raw: bytes, contract, secret });
console.log(`[workforce:source-contract] PASS actual synthetic SQL export; ${JSON.stringify(snapshot.counts)}; ${bytes.length} bytes; exact scoped HMAC accepted`);
