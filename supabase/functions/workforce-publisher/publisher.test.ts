import { handleWorkforcePublisher } from './handler.ts';
import { publishWorkforce, PublisherFailure, WORKFORCE_DESTINATION, type Lease, type Pending, type PublisherStore } from './publisher.ts';
import { validateWorkforceRequest, workforcePayloadHash, workforceSha256 } from './contract/protocol.ts';
import type { WorkforceRecords } from './contract/types.ts';
import { publisherStore } from './rpc.ts';
function assert(value: unknown, message = 'assertion failed'): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown) { assert(JSON.stringify(actual) === JSON.stringify(expected), 'Values differ'); }
async function refused(promise: Promise<unknown>, code: string) { try { await promise; throw new Error('Expected refusal'); } catch (error) { assert(error instanceof PublisherFailure && error.code === code, `Expected ${code}`); } }
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const secret = 'synthetic-workforce-test-secret-only-123456789';
const observed = '2026-09-23T12:00:00.000Z'; const clock = () => Date.parse(observed);
const records = (): WorkforceRecords => ({ units: [], people: [], assignments: [], roles: [], reporting: [] });
function fakeStore() {
  const state = { pending: null as Pending | null, sequence: 0, exports: 0, completed: 0, released: [] as string[], records: records(), mode: 'ready' };
  const store: PublisherStore = {
    acquire: async () => state.mode === 'ready' ? { acquired: true, organization_id: id(1), key_id: 'cornerstone_workforce_v1', destination_url: WORKFORCE_DESTINATION, generation: 1, lease_token: id(2), sequence: state.sequence, pending: state.pending } : { acquired: false, reason: state.mode },
    export: async () => { state.exports++; return { source_as_of: observed, records: state.records }; },
    storePending: async (_f, body, hash) => { const value = JSON.parse(body); state.pending = { body, body_sha256: hash, batch_id: value.batch_id, sequence: value.sequence, source_as_of: value.source_as_of }; return state.pending; },
    complete: async (_f, receipt) => { equal(receipt.body_sha256, state.pending?.body_sha256); state.sequence = state.pending!.sequence; state.pending = null; state.completed++; },
    release: async (_f, _outcome, code) => { state.released.push(code ?? ''); },
  };
  return { state, store };
}
function receiver(received: string[] = [], replayed = false): typeof fetch {
  return async (_input, init) => {
    const request = init as { redirect: string; body: Uint8Array; method: string; headers: HeadersInit };
    assert(request.redirect === 'error');
    const raw = new Uint8Array(request.body);
    const checked = await validateWorkforceRequest({ method: request.method, headers: new Headers(request.headers), raw,
      contract: { key_id: 'cornerstone_workforce_v1', source_system: 'cornerstone', source_tenant_id: id(1), dataset: 'workforce_roster', enabled: true }, secret, now: clock() });
    received.push(new TextDecoder().decode(raw));
    return Response.json({ receipt_id: id(3), source_id: id(4), batch_id: checked.snapshot.batch_id, sequence: checked.snapshot.sequence,
      source_as_of: checked.snapshot.source_as_of, received_at: observed, body_sha256: checked.body_sha256, replayed });
  };
}
Deno.test('complete empty roster conforms to the frozen scoped receiver; successive runs advance sequence', async () => {
  const { state, store } = fakeStore(); const received: string[] = [];
  equal((await publishWorkforce(store, 'cornerstone', secret, receiver(received), clock)).outcome, 'published');
  await publishWorkforce(store, 'cornerstone', secret, receiver(received), clock);
  equal(state.sequence, 2); equal(state.completed, 2); equal(state.pending, null);
  assert(JSON.parse(received[0]).batch_id !== JSON.parse(received[1]).batch_id);
});
Deno.test('timeout retains exact pending bytes and batch while the retry uses fresh headers', async () => {
  const { state, store } = fakeStore(); let attempted = '';
  await refused(publishWorkforce(store, 'cornerstone', secret, (_i, init) => { attempted = new TextDecoder().decode((init as { body: Uint8Array }).body); throw new Error('Private transport detail'); }, clock), 'destination_unavailable');
  assert(state.pending); equal(state.pending.body, attempted); equal(state.sequence, 0);
  const received: string[] = [];
  await publishWorkforce(store, 'cornerstone', secret, receiver(received, true), () => clock() + 1_000);
  equal(received, [attempted]); equal(state.exports, 1); equal(state.sequence, 1);
});
Deno.test('rejected/oversized/mismatched receipt never advances watermark or clears pending', async () => {
  for (const send of [async () => new Response('sensitive error ignored', { status: 409 }), async () => Response.json({ receipt_id: id(3), body_sha256: 'wrong' }), async () => new Response('x'.repeat(5000))]) {
    const { state, store } = fakeStore();
    await refused(publishWorkforce(store, 'cornerstone', secret, send, clock), (await send()).status === 409 ? 'destination_rejected' : 'invalid_receipt');
    assert(state.pending); equal(state.sequence, 0); equal(state.completed, 0);
  }
});
Deno.test('disabled and busy workers neither export nor send', async () => {
  for (const mode of ['disabled', 'busy']) { const { state, store } = fakeStore(); state.mode = mode; equal((await publishWorkforce(store, 'cornerstone', secret, () => { throw new Error('must not send'); }, clock)).outcome, mode); equal(state.exports, 0); }
});
Deno.test('destination/scope and forbidden source fields fail closed before network', async () => {
  const { store } = fakeStore(); const acquire = store.acquire;
  store.acquire = async id => ({ ...await acquire(id), destination_url: 'https://example.invalid/steal' } as Lease);
  await refused(publishWorkforce(store, 'cornerstone', secret, receiver(), clock), 'publisher_unconfigured');
  const other = fakeStore(); (other.state.records as unknown as Record<string, unknown>).email = 'synthetic@example.invalid';
  await refused(publishWorkforce(other.store, 'cornerstone', secret, receiver(), clock), 'invalid_source_records'); equal(other.state.pending, null);
});
Deno.test('corrupt stored payload with a recalculated raw hash is revalidated', async () => {
  const { state, store } = fakeStore();
  await refused(publishWorkforce(store, 'cornerstone', secret, async () => new Response(null, { status: 503 }), clock), 'destination_rejected');
  const snapshot = JSON.parse(state.pending!.body); snapshot.records.contact_details = 'forbidden'; snapshot.payload_sha256 = await workforcePayloadHash(snapshot.records);
  state.pending!.body = JSON.stringify(snapshot); state.pending!.body_sha256 = await workforceSha256(new TextEncoder().encode(state.pending!.body));
  await refused(publishWorkforce(store, 'cornerstone', secret, receiver(), clock), 'invalid_pending'); equal(state.completed, 0);
});
Deno.test('cron endpoint is fail-closed and never accepts caller-chosen tenant or content', async () => {
  const { state, store } = fakeStore(); const env = { cronSecret: secret, ingestSecret: secret };
  const call = (headers: HeadersInit, body: string) => handleWorkforcePublisher(new Request('https://example.invalid/publish', { method: 'POST', headers, body }), env, () => store, 'cornerstone');
  equal((await call({}, '{}')).status, 401);
  equal((await call({ 'x-cron-secret': secret }, '{"organization_id":"other"}')).status, 400);
  const missing = await handleWorkforcePublisher(new Request('https://example.invalid', { method: 'POST' }), {}, () => store, 'cornerstone'); equal(missing.status, 503);
  equal(state.exports, 0);
});
Deno.test('valid source rows exceeding two MiB fail visibly without persisting or sending a partial batch', async () => {
  const { state, store } = fakeStore(); let sends = 0;
  state.records.people = Array.from({ length: 4000 }, (_, n) => ({
    source_record_id: id(n + 100), record_type: 'person', record_state: 'present', source_updated_at: observed, record_retired_at: null, record_deleted_at: null,
    display_name: 'Synthetic '.repeat(19).trim(), person_kind: 'contact', staff_role: null, job_title: null, employment_status: 'unknown', employer_ref: null,
    source_hire_date: null, source_termination_date: null, last_day_worked: null, effective_employment_end: null, source_processed_at: null,
    pay_basis: null, pay_basis_effective_from: null, pay_basis_evidence: null,
  }));
  assert(new TextEncoder().encode(JSON.stringify(state.records)).byteLength > 2 * 1024 * 1024);
  await refused(publishWorkforce(store, 'cornerstone', secret, () => { sends++; return Promise.resolve(new Response(null)); }, clock), 'oversized_snapshot');
  equal(state.pending, null); equal(state.sequence, 0); equal(sends, 0); equal(state.released, ['oversized_snapshot']);
});
Deno.test('only bounded known source SQL oversize errors become oversized_snapshot', async () => {
  const fence = { run_id: id(1), lease_token: id(2), generation: 1 };
  for (const message of ['workforce_export_oversized', 'Roster exceeds single-snapshot limits']) {
    const store = publisherStore('https://example.invalid', secret, () => Promise.resolve(Response.json({ code: '22023', message }, { status: 400 })));
    await refused(store.export(fence), 'oversized_snapshot');
  }
  for (const error of [{ code: '22023', message: 'Private source value' }, { code: '42501', message: 'workforce_export_oversized' }, { code: '22023', message: 'workforce_export_oversized', details: 'x'.repeat(5000) }]) {
    const store = publisherStore('https://example.invalid', secret, () => Promise.resolve(Response.json(error, { status: 400 })));
    await refused(store.export(fence), 'database_unavailable');
  }
});
