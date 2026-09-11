import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { GET as LIST, POST as DELIVER } from "./route";
import { POST as RECONCILE } from "./[id]/reconcile/route";
import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";

const rpc = vi.fn();
const maybeSingle = vi.fn();
const eqCalls: Array<[string, unknown]> = [];
const orders: Array<[string, unknown]> = [];
const readRanges: number[] = [];
let readCap = 1000;
let failPageAt: number | null = null;
let listRows: unknown[] = [];
const from = vi.fn(() => {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn((column: string, value: unknown) => { eqCalls.push([column, value]); return query; });
  query.order = vi.fn((column: string, options: unknown) => { orders.push([column, options]); return query; });
  query.range = async (start: number, end: number) => {
    readRanges.push(start);
    if (start === failPageAt) return { data: null, error: { message: "later page unavailable" } };
    return { data: listRows.slice(start, Math.min(end + 1, start + readCap)), error: null };
  };
  query.maybeSingle = maybeSingle;
  return query;
});
const actor = { id: "actor", organizationId: "org", appRole: "facility_admin", currentActor: { client: { rpc, from } } };
const facilityId = "33333333-3333-4333-8333-333333333333";
const occurrenceId = "55555555-5555-4555-8555-555555555555";
const eventId = "66666666-6666-4666-8666-666666666666";
const key = "deliver:2026-09-10:0001";
const revision = "a".repeat(64);
const payload = { source_key: "drill-log", source_record_id: "D-1", source_record_version: "1", event_kind: "final", facility_id: facilityId };
const post = (url: string, body: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const outcome = {
  event: { id: eventId, state: "satisfied", attention: false, request_hash: "f".repeat(64), facility_id: facilityId },
  occurrence: { id: occurrenceId, status: "completed", execution_state: "completed", occurrence_revision: "c".repeat(64), performed_at: null },
  receipt: { id: "77777777-7777-4777-8777-777777777777", request_hash: "f".repeat(64), completion_state: "completed" },
  candidates: [occurrenceId],
  replayed: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  eqCalls.length = 0;
  orders.length = 0;
  readRanges.length = 0;
  readCap = 1000;
  failPageAt = null;
  listRows = [];
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  maybeSingle.mockResolvedValue({ data: { id: eventId, facility_id: facilityId, organization_id: "org", state: "ambiguous", attention: true }, error: null });
});

describe("deliver a source event", () => {
  it("refuses a malformed body with the validation class before any command", async () => {
    const response = await DELIVER(post("https://local.test/source-events", { request_key: key, payload: { ...payload, event_kind: "draft" } }));
    expect(response.status).toBe(400);
    expect((await response.json()).outcome).toBe("validation");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("treats an unheld site as missing before the command", async () => {
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    const response = await DELIVER(post("https://local.test/source-events", { request_key: key, payload }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Facility not found", outcome: "missing" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards the request key and payload, revalidates the actor, and strips idempotency material from the reply", async () => {
    rpc.mockResolvedValueOnce({ data: outcome, error: null });
    const response = await DELIVER(post("https://local.test/source-events", { request_key: key, payload }));
    expect(response.status).toBe(200);
    expect(revalidateOperationsActor).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("deliver_operation_source_event_review", { p_request_key: key, p_payload: payload });
    const body = await response.json();
    expect(body.outcome).toBe("receipt");
    expect(body.event).toEqual({ id: eventId, state: "satisfied", attention: false, facility_id: facilityId });
    expect(body.receipt).toEqual({ id: "77777777-7777-4777-8777-777777777777", completion_state: "completed" });
    expect(body.candidates).toEqual([occurrenceId]);
    expect(body.replayed).toBe(false);
  });

  it("maps the database outcome classes: allowlist refusal, denial, replay conflict and uncertainty", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Source adapter is not allowlisted" } });
    let response = await DELIVER(post("https://local.test/source-events", { request_key: key, payload }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Source adapter is not allowlisted", outcome: "validation" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Operation unavailable" } });
    response = await DELIVER(post("https://local.test/source-events", { request_key: key, payload }));
    expect(response.status).toBe(403);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "This request was already saved with different content" } });
    response = await DELIVER(post("https://local.test/source-events", { request_key: key, payload }));
    expect(response.status).toBe(409);
    expect((await response.json()).outcome).toBe("conflict");
    rpc.mockResolvedValueOnce({ data: { event: { id: eventId } }, error: null });
    response = await DELIVER(post("https://local.test/source-events", { request_key: key, payload }));
    expect(response.status).toBe(500);
    expect((await response.json()).outcome).toBe("uncertain");
  });
});

describe("list source events", () => {
  it("requires a held facility and defaults to the rows that need attention", async () => {
    let response = await LIST(new NextRequest("https://local.test/source-events"));
    expect(response.status).toBe(400);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    response = await LIST(new NextRequest(`https://local.test/source-events?facility_id=${facilityId}`));
    expect(response.status).toBe(404);
    listRows = [{ id: "e1", request_hash: "f".repeat(64), state: "unmatched" }];
    response = await LIST(new NextRequest(`https://local.test/source-events?facility_id=${facilityId}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: [{ id: "e1", state: "unmatched" }], total: 1, attention: true, state: null });
    // The builder is rebuilt for every page, including the terminal empty one.
    expect(eqCalls.slice(0, 3)).toEqual([["organization_id", "org"], ["facility_id", facilityId], ["attention", true]]);
    expect(orders.slice(0, 2)).toEqual([["delivered_at", { ascending: true }], ["id", { ascending: true }]]);
    expect(readRanges).toEqual([0, 1]);
  });

  it("filters settled rows by state and reads beyond the provider cap to an exact total", async () => {
    readCap = 3;
    listRows = Array.from({ length: 7 }, (_, index) => ({ id: `e${index}`, state: "dismissed" }));
    const response = await LIST(new NextRequest(`https://local.test/source-events?facility_id=${facilityId}&attention=false&state=dismissed`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(7);
    expect(body.events.map((event: { id: string }) => event.id)).toEqual(["e0", "e1", "e2", "e3", "e4", "e5", "e6"]);
    expect(readRanges).toEqual([0, 3, 6, 7]);
    expect(eqCalls).toContainEqual(["state", "dismissed"]);
    expect(eqCalls).toContainEqual(["attention", false]);
  });

  it("does not add the attention filter when only a state is named", async () => {
    listRows = [{ id: "e1", state: "satisfied", attention: false }];
    const response = await LIST(new NextRequest(`https://local.test/source-events?facility_id=${facilityId}&state=satisfied`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ events: listRows, total: 1, attention: null, state: "satisfied" });
    expect(eqCalls.some(([column]) => column === "attention")).toBe(false);
    expect(eqCalls).toContainEqual(["state", "satisfied"]);
  });

  it("reports a failed later page as unavailable rather than a shorter list", async () => {
    readCap = 2;
    failPageAt = 2;
    listRows = Array.from({ length: 5 }, (_, index) => ({ id: `e${index}` }));
    const response = await LIST(new NextRequest(`https://local.test/source-events?facility_id=${facilityId}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Source deliveries unavailable", outcome: "uncertain" });
  });
});

describe("reconcile a source event", () => {
  const body = { request_key: key, expected_revision: revision, payload: { action: "select", occurrence_id: occurrenceId } };

  it("refuses a bad id, a malformed body and an unreadable or unheld delivery before the command", async () => {
    expect((await RECONCILE(post("https://local.test/reconcile", body), params("nope"))).status).toBe(404);
    const malformed = await RECONCILE(post("https://local.test/reconcile", { ...body, payload: { action: "dismiss" } }), params(eventId));
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error).toBe("dismiss requires a reason");
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await RECONCILE(post("https://local.test/reconcile", body), params(eventId))).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    expect((await RECONCILE(post("https://local.test/reconcile", body), params(eventId))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await RECONCILE(post("https://local.test/reconcile", body), params(eventId))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards the event, key, expected revision and payload and returns the settled outcome", async () => {
    rpc.mockResolvedValueOnce({ data: { ...outcome, replayed: true }, error: null });
    const response = await RECONCILE(post("https://local.test/reconcile", body), params(eventId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("reconcile_operation_source_event_review", { p_event: eventId, p_request_key: key, p_expected_revision: revision, p_payload: body.payload });
    const json = await response.json();
    expect(json.replayed).toBe(true);
    expect(json.event.state).toBe("satisfied");
  });

  it("returns a moved revision as a conflict naming the current one and a settled row as a conflict", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Event changed since it was read", details: `current_event_revision=${"b".repeat(64)}` } });
    let response = await RECONCILE(post("https://local.test/reconcile", body), params(eventId));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Event changed since it was read", outcome: "conflict", current_event_revision: "b".repeat(64) });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Source delivery is settled" } });
    response = await RECONCILE(post("https://local.test/reconcile", body), params(eventId));
    expect(response.status).toBe(409);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Selected occurrence is not a candidate for this source record" } });
    response = await RECONCILE(post("https://local.test/reconcile", body), params(eventId));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Selected occurrence is not a candidate for this source record");
  });
});
