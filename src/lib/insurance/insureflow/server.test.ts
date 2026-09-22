// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import fixtures from "./synthetic-fixtures.json";
import { applyFeedPage, initialReceiverState, type ReceiverState } from "./receiver";
import { createReceiverStore, ReceiverStoreError, runSyntheticReceiver, type ReceiverConnection, type ReceiverClaimRequest, type ReceiverFence, type ReceiverFailureCode, type ReceiverStore } from "./server";
import { createSyntheticFeedTransport, SYNTHETIC_FEED_ORIGIN } from "./transport";

const integrationId = fixtures.synthetic_crosswalk_example.source_integration_id;
const accountId = fixtures.synthetic_crosswalk_example.source_account_id;
const organizationId = fixtures.synthetic_crosswalk_example.haven_organization_id;
const entityId = fixtures.synthetic_crosswalk_example.haven_entity_id;
const connectionId = "70000000-0000-4000-8000-000000000001";
const providerInstance = "synthetic:fixture";
const now = "2026-10-02T00:10:00Z";
const scenario = (name: string) => structuredClone(fixtures.scenarios.find(item => item.name === name)!.response);
const jsonResponse = (raw: unknown) => new Response(JSON.stringify(raw), { headers: { "content-type": "application/json" } });
const transport = (fetch: (url: string, init: RequestInit) => Promise<Response>) => createSyntheticFeedTransport({ mode: "synthetic", origin: SYNTHETIC_FEED_ORIGIN, integrationId, token: `hvn_${"a".repeat(64)}`, fetch });
function apply(state: ReceiverState, raw: unknown) {
  return applyFeedPage(state, raw, { integrationId, after: state.cursor, mode: "normal", now, approvedAccountIds: [accountId] });
}
function currentState() {
  return apply(apply(initialReceiverState(), scenario("superseded_page_one")), scenario("superseded_page_two"));
}
function faultInitialState() {
  const raw = scenario("initial_approved_release");
  const releaseId = "40000000-0000-4000-8000-000000000004";
  raw.data.current_authorized_releases[0].release_id = releaseId;
  raw.data.current_authorized_releases[0].sequence = "4";
  raw.data.events[0].id = releaseId;
  raw.data.events[0].sequence = "4";
  raw.data.next_cursor = "4";
  return apply(initialReceiverState(), raw);
}

/** Fenced persistence fake, not a substitute for the separately executed PostgreSQL probes. */
class MemoryStore implements ReceiverStore {
  connection: ReceiverConnection;
  commits: ReceiverState[] = [];
  failures: { state: ReceiverState; code: ReceiverFailureCode }[] = [];
  nowMs = Date.parse(now);
  rejectCommit = false;
  constructor(state = initialReceiverState()) {
    this.connection = { id: connectionId, organization_id: organizationId, source_integration_id: integrationId, provider_instance: providerInstance, mode: "synthetic", enabled: true, ttl_seconds: 300, mappings: [{ account_id: accountId, entity_id: entityId, approved: true }], config_generation: 1, revision: 1, lease_token: null, lease_expires_at: null, state: structuredClone(state) };
  }
  async claim(request: ReceiverClaimRequest) {
    if (!this.connection.enabled || this.connection.state.health === "credential_rejected") throw new ReceiverStoreError("40001");
    if (this.connection.lease_token && Date.parse(this.connection.lease_expires_at!) > this.nowMs) throw new ReceiverStoreError("40001");
    expect(request.connection_id).toBe(connectionId);
    expect(request.organization_id).toBe(organizationId);
    this.connection.lease_token = request.lease_token;
    this.connection.lease_expires_at = new Date(this.nowMs + request.lease_seconds * 1000).toISOString();
    this.connection.revision++;
    return structuredClone(this.connection);
  }
  check(fence: ReceiverFence) {
    if (fence.id !== this.connection.id || fence.organization_id !== this.connection.organization_id || fence.lease_token !== this.connection.lease_token || fence.config_generation !== this.connection.config_generation || fence.revision !== this.connection.revision || Date.parse(this.connection.lease_expires_at!) <= this.nowMs) throw new ReceiverStoreError("40001");
  }
  finish(state: ReceiverState) {
    this.connection.state = structuredClone(state);
    this.connection.revision++;
    this.connection.lease_token = null;
    this.connection.lease_expires_at = null;
    return structuredClone(this.connection);
  }
  async commit(fence: ReceiverFence, state: ReceiverState) {
    this.check(fence);
    if (this.rejectCommit) throw new ReceiverStoreError();
    this.commits.push(structuredClone(state));
    return this.finish(state);
  }
  async fail(fence: ReceiverFence, state: ReceiverState, code: ReceiverFailureCode) {
    this.check(fence);
    this.failures.push({ state: structuredClone(state), code });
    return this.finish(state);
  }
  reconfigure(state = this.connection.state) {
    this.connection.config_generation++;
    this.connection.revision++;
    this.connection.lease_token = null;
    this.connection.lease_expires_at = null;
    this.connection.state = structuredClone(state);
  }
}
const run = (store: ReceiverStore, fetch: (url: string, init: RequestInit) => Promise<Response>, maxPages?: number) => runSyntheticReceiver({ mode: "synthetic", connectionId, organizationId, providerInstance, store, transport: transport(fetch), maxPages, now: () => now });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("synthetic worker with the real receiver reducer", () => {
  it("commits an authorized supplied fixture without creating any canonical policy records", async () => {
    const store = new MemoryStore();
    const fetch = vi.fn().mockImplementation(async () => jsonResponse(scenario("initial_approved_release")));
    expect(await run(store, fetch)).toEqual({ status: "committed", pagesCommitted: 1 });
    expect(store.connection.state.cursor).toBe("1");
    expect(store.connection.state.health).toBe("healthy");
    expect(Object.values(store.connection.state.receipts)[0].snapshot?.policy_number).toBe("SYNTHETIC-GL-0001");
    expect(store.failures).toHaveLength(0);
  });
  it("accepts mixed valid controls atomically with quarantine and unrelated withdrawal", async () => {
    const store = new MemoryStore(faultInitialState());
    const raw = fixtures.fault_injection_cases.find(item => item.name === "valid_controls_bad_date_and_unrelated_withdrawal")!.response;
    const fetch = vi.fn().mockImplementation(async () => jsonResponse(raw));
    expect(await run(store, fetch, 1)).toEqual({ status: "limit_reached", pagesCommitted: 1 });
    expect(store.connection.state.cursor).toBe("7");
    expect(store.connection.state.manifest).toHaveLength(2);
    expect(store.connection.state.receipts["40000000-0000-4000-8000-000000000004"].snapshot).toBeNull();
    expect(store.connection.state.receipts["40000000-0000-4000-8000-000000000006"]).toMatchObject({ snapshot: null, quarantine: "snapshot_date" });
    expect(store.connection.state.receipts["40000000-0000-4000-8000-000000000007"].snapshot?.policy_number).toBe("SYNTHETIC-VALID-0003");
    expect(store.connection.state.recovery["40000000-0000-4000-8000-000000000006"].attempts).toBe(1);
    expect(store.commits).toHaveLength(1);
  });
  it("rejects malformed controls without changing membership, receipts, freshness or cursor", async () => {
    const state = faultInitialState();
    const store = new MemoryStore(state);
    const raw = fixtures.fault_injection_cases.find(item => item.name === "invalid_control_manifest_duplicate_reject_entire_page")!.response;
    expect(await run(store, async () => jsonResponse(raw))).toEqual({ status: "failed", pagesCommitted: 0 });
    expect(store.connection.state).toEqual(state);
    expect(store.failures[0].code).toBe("invalid_controls");
    expect(store.commits).toHaveLength(0);
  });
  it("recovers an out-and-back release using replay plus a separate final normal poll", async () => {
    const state = apply(currentState(), scenario("empty_delta_source_moved_out"));
    const store = new MemoryStore(state);
    const pages = [scenario("empty_delta_source_returned_to_scope"), scenario("recovery_replay_from_zero"), scenario("empty_delta_source_returned_to_scope")];
    const fetch = vi.fn().mockImplementation(async () => jsonResponse(pages.shift()));
    expect(await run(store, fetch)).toEqual({ status: "committed", pagesCommitted: 3 });
    expect(fetch.mock.calls.map(call => new URL(call[0]).searchParams.get("after"))).toEqual(["2", "0", "2"]);
    expect(store.commits.map(state => state.cursor)).toEqual(["2", "2", "2"]);
    const release = "40000000-0000-4000-8000-000000000002";
    expect(store.commits[1].receipts[release].needs_confirmation).toBe(true);
    expect(store.commits[1].health).toBe("degraded");
    expect(store.commits[2].receipts[release].needs_confirmation).toBe(false);
    expect(store.connection.state.health).toBe("healthy");
    expect(Object.keys(store.connection.state.receipts)).toHaveLength(2);
  });
  it("does not publish a returned body through an unapproved account mapping", async () => {
    const store = new MemoryStore();
    store.connection.mappings[0].approved = false;
    await run(store, async () => jsonResponse(scenario("initial_approved_release")), 1);
    expect(Object.values(store.connection.state.receipts)[0]).toMatchObject({ snapshot: null, quarantine: "account_mapping_unapproved" });
    expect(store.connection.state.health).toBe("degraded");
  });
  it("preserves the previous cursor on commit failure and retries only after a new explicit invocation/lease", async () => {
    const store = new MemoryStore();
    store.rejectCommit = true;
    const fetch = vi.fn().mockImplementation(async () => jsonResponse(scenario("initial_approved_release")));
    await expect(run(store, fetch)).rejects.toBeInstanceOf(ReceiverStoreError);
    expect(store.connection.state).toEqual(initialReceiverState());
    expect(store.failures).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    store.rejectCommit = false;
    store.nowMs += 61_000;
    expect(await run(store, fetch)).toEqual({ status: "committed", pagesCommitted: 1 });
    expect(fetch.mock.calls.map(call => new URL(call[0]).searchParams.get("after"))).toEqual(["0", "0"]);
  });
  it("fences successful responses after mapping/configuration changes", async () => {
    const store = new MemoryStore();
    const fetch = vi.fn().mockImplementation(async () => { store.reconfigure(); return jsonResponse(scenario("initial_approved_release")); });
    expect(await run(store, fetch)).toEqual({ status: "fenced", pagesCommitted: 0 });
    expect(store.connection.state).toEqual(initialReceiverState());
    expect(store.failures).toHaveLength(0);
  });
  it("fences delayed 401 failures instead of hiding a newer healthy configuration", async () => {
    const store = new MemoryStore();
    const healthy = currentState();
    const fetch = vi.fn().mockImplementation(async () => { store.reconfigure(healthy); return new Response("revoked", { status: 401 }); });
    expect(await run(store, fetch)).toEqual({ status: "fenced", pagesCommitted: 0 });
    expect(store.connection.state).toEqual(healthy);
    expect(store.failures).toHaveLength(0);
  });
  it("marks a current 401 unavailable and does not retry that credential on the next invocation", async () => {
    const before = currentState();
    const store = new MemoryStore(before);
    const fetch = vi.fn().mockImplementation(async () => new Response("revoked", { status: 401 }));
    expect(await run(store, fetch)).toEqual({ status: "credential_rejected", pagesCommitted: 0 });
    expect(store.connection.state).toEqual({ ...before, health: "credential_rejected", authorization_checked_at: null });
    expect(await run(store, fetch)).toEqual({ status: "fenced", pagesCommitted: 0 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("preserves state on ordinary transport failures without retrying the page", async () => {
    const before = currentState();
    const store = new MemoryStore(before);
    const fetch = vi.fn().mockImplementation(async () => new Response("unavailable", { status: 503 }));
    expect(await run(store, fetch)).toEqual({ status: "failed", pagesCommitted: 0 });
    expect(store.connection.state).toEqual(before);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects expired leases, pinned integration mismatch and excessive worker budgets", async () => {
    const store = new MemoryStore();
    const fetch = vi.fn().mockImplementation(async () => { store.nowMs += 61_000; return jsonResponse(scenario("initial_approved_release")); });
    expect(await run(store, fetch)).toEqual({ status: "fenced", pagesCommitted: 0 });
    const changed = new MemoryStore();
    changed.connection.source_integration_id = "10000000-0000-4000-8000-000000000099";
    const unused = vi.fn();
    expect(await run(changed, unused)).toEqual({ status: "failed", pagesCommitted: 0 });
    expect(unused).not.toHaveBeenCalled();
    await expect(run(new MemoryStore(), unused, 21)).rejects.toMatchObject({ code: "invalid_configuration" });
  });
});

describe("service-only RPC adapter", () => {
  it("sends the exact lease/configuration/revision fence for success and failure", async () => {
    const connection = new MemoryStore().connection;
    const rpc = vi.fn().mockResolvedValue({ data: connection, error: null });
    const store = createReceiverStore({ rpc });
    const request = { connection_id: connectionId, organization_id: organizationId, lease_token: "lease", lease_seconds: 60 };
    await store.claim(request);
    expect(rpc).toHaveBeenLastCalledWith("insureflow_receiver_service", { p_action: "claim", p_payload: request });
    await store.commit(connection, connection.state);
    expect(rpc).toHaveBeenLastCalledWith("insureflow_receiver_service", { p_action: "commit", p_payload: { connection_id: connectionId, organization_id: organizationId, lease_token: null, config_generation: 1, expected_revision: 1, state: connection.state } });
    await store.fail(connection, connection.state, "transport_error");
    expect(rpc.mock.calls[2][1].p_payload.error_code).toBe("transport_error");
  });
  it("retains fence conflicts while redacting arbitrary database error text", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "40001", message: "private raw state" } });
    const store = createReceiverStore({ rpc });
    await expect(store.claim({ connection_id: connectionId, organization_id: organizationId, lease_token: "lease", lease_seconds: 60 })).rejects.toMatchObject({ code: "40001" });
    rpc.mockRejectedValue(new Error("server secret"));
    await expect(store.claim({ connection_id: connectionId, organization_id: organizationId, lease_token: "lease", lease_seconds: 60 })).rejects.toThrow("Receiver persistence could not complete");
  });
});

it("exhausts malformed-body recovery after three replay attempts instead of looping", async () => {
  const store = new MemoryStore();
  const malformed = scenario("initial_approved_release");
  malformed.data.events[0].snapshot!.effective_date = "2026-02-30";
  const delta = structuredClone(malformed);
  delta.data.events = [];
  const fetch = vi.fn().mockImplementation(async (url: string) => jsonResponse(new URL(url).searchParams.get("after") === "0" ? malformed : delta));
  expect(await run(store, fetch, 20)).toEqual({ status: "committed", pagesCommitted: 7 });
  expect(fetch.mock.calls.map(call => new URL(call[0]).searchParams.get("after"))).toEqual(["0", "0", "1", "0", "1", "0", "1"]);
  expect(Object.values(store.connection.state.recovery)[0]).toMatchObject({ attempts: 3, status: "exhausted" });
  expect(store.connection.state.health).toBe("degraded");
  expect(store.connection.state.cursor).toBe("1");
});
