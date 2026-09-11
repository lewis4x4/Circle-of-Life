import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { GET as LIST, POST as RECORD } from "./route";
import { POST as COMMAND } from "./[id]/route";
import { actorCanAccessFacility, requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";

const rpc = vi.fn();
const maybeSingle = vi.fn();
const eqCalls: Array<[string, unknown]> = [];
const filterCalls: Array<[string, string, unknown]> = [];
const orders: Array<[string, unknown]> = [];
const readRanges: number[] = [];
let readCap = 1000;
let failPageAt: number | null = null;
let listRows: unknown[] = [];
const from = vi.fn(() => {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn((column: string, value: unknown) => { eqCalls.push([column, value]); return query; });
  query.is = vi.fn((column: string, value: unknown) => { filterCalls.push([column, "is", value]); return query; });
  query.not = vi.fn((column: string, operator: string, value: unknown) => { filterCalls.push([column, `not.${operator}`, value]); return query; });
  query.order = vi.fn((column: string, options: unknown) => { orders.push([column, options]); return query; });
  query.range = async (start: number, end: number) => {
    readRanges.push(start);
    if (start === failPageAt) return { data: null, error: { message: "later page unavailable" } };
    return { data: listRows.slice(start, Math.min(end + 1, start + readCap)), error: null };
  };
  query.maybeSingle = maybeSingle;
  return query;
});
const actor = { id: "actor", organizationId: "org", appRole: "maintenance_role", currentActor: { client: { rpc, from } } };
const facilityId = "33333333-3333-4333-8333-333333333333";
const assetId = "44444444-4444-4444-8444-444444444444";
const observationId = "88888888-8888-4888-8888-888888888888";
const key = "obs:2026-09-10:0001";
const payload = { facility_id: facilityId, asset_id: assetId, observation_kind: "generator_test", basis: "staff_observed", observed_at: "2026-09-10T14:00:00-04:00", outcome: "pass", readings: { started_ok: true } };
const post = (url: string, body: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const outcome = {
  record: { id: observationId, record_version: 1, facility_id: facilityId, finalized_at: "2026-09-10T18:05:00Z" },
  delivery: {
    event: { id: "66666666-6666-4666-8666-666666666666", state: "satisfied", attention: false, request_hash: "f".repeat(64) },
    occurrence: { id: "55555555-5555-4555-8555-555555555555", status: "completed" },
    receipt: { id: "77777777-7777-4777-8777-777777777777", request_hash: "f".repeat(64) },
    candidates: ["55555555-5555-4555-8555-555555555555"],
    replayed: false,
  },
  linked: true,
  replayed: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  eqCalls.length = 0;
  filterCalls.length = 0;
  orders.length = 0;
  readRanges.length = 0;
  readCap = 1000;
  failPageAt = null;
  listRows = [];
  vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(revalidateOperationsActor).mockResolvedValue({ actor } as never);
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  maybeSingle.mockResolvedValue({ data: { id: observationId, facility_id: facilityId, organization_id: "org" }, error: null });
});

describe("record an asset observation", () => {
  it("refuses a malformed body before any command and treats an unheld site as missing", async () => {
    let response = await RECORD(post("https://local.test/asset-observations", { request_key: key, payload: { ...payload, observation_kind: "sniff_test" } }));
    expect(response.status).toBe(400);
    expect((await response.json()).outcome).toBe("validation");
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    response = await RECORD(post("https://local.test/asset-observations", { request_key: key, payload }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Facility not found", outcome: "missing" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards the request key and payload, revalidates the actor, and returns the record with the delivery stripped of idempotency material", async () => {
    rpc.mockResolvedValueOnce({ data: outcome, error: null });
    const response = await RECORD(post("https://local.test/asset-observations", { request_key: key, payload }));
    expect(response.status).toBe(200);
    expect(revalidateOperationsActor).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("record_asset_observation_review", { p_request_key: key, p_payload: payload });
    const body = await response.json();
    expect(body.outcome).toBe("record");
    expect(body.record).toEqual(outcome.record);
    expect(body.delivery.event).toEqual({ id: "66666666-6666-4666-8666-666666666666", state: "satisfied", attention: false });
    expect(body.delivery.receipt).toEqual({ id: "77777777-7777-4777-8777-777777777777" });
    expect(body.linked).toBe(true);
  });

  it("maps the database outcome classes: a refusal by name, a denial, a replay conflict and uncertainty", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "An automatic self-test is not a staff observation; record only what a staff member observed" } });
    let response = await RECORD(post("https://local.test/asset-observations", { request_key: key, payload: { ...payload, basis: "automatic_self_test" } }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "An automatic self-test is not a staff observation; record only what a staff member observed", outcome: "validation" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Operation unavailable" } });
    response = await RECORD(post("https://local.test/asset-observations", { request_key: key, payload }));
    expect(response.status).toBe(403);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "This request was already saved with different content" } });
    response = await RECORD(post("https://local.test/asset-observations", { request_key: key, payload }));
    expect(response.status).toBe(409);
    rpc.mockResolvedValueOnce({ data: { record: { id: observationId } }, error: null });
    response = await RECORD(post("https://local.test/asset-observations", { request_key: key, payload }));
    expect(response.status).toBe(500);
    expect((await response.json()).outcome).toBe("uncertain");
  });
});

describe("list asset observations", () => {
  it("requires a held site and reads beyond the provider cap to an exact total with the requested filters", async () => {
    let response = await LIST(new NextRequest("https://local.test/asset-observations"));
    expect(response.status).toBe(400);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    response = await LIST(new NextRequest(`https://local.test/asset-observations?facility_id=${facilityId}`));
    expect(response.status).toBe(404);
    readCap = 3;
    listRows = Array.from({ length: 7 }, (_, index) => ({ id: `o${index}` }));
    response = await LIST(new NextRequest(`https://local.test/asset-observations?facility_id=${facilityId}&asset_id=${assetId}&kind=generator_test&voided=false`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(7);
    expect(body.observations.map((row: { id: string }) => row.id)).toEqual(["o0", "o1", "o2", "o3", "o4", "o5", "o6"]);
    expect(readRanges).toEqual([0, 3, 6, 7]);
    expect(eqCalls.slice(0, 4)).toEqual([["organization_id", "org"], ["facility_id", facilityId], ["asset_id", assetId], ["observation_kind", "generator_test"]]);
    expect(filterCalls[0]).toEqual(["voided_at", "is", null]);
    expect(orders.slice(0, 2)).toEqual([["observed_at", { ascending: false }], ["id", { ascending: true }]]);
  });

  it("reports a failed later page as unavailable rather than a shorter list", async () => {
    readCap = 2;
    failPageAt = 2;
    listRows = Array.from({ length: 5 }, (_, index) => ({ id: `o${index}` }));
    const response = await LIST(new NextRequest(`https://local.test/asset-observations?facility_id=${facilityId}&voided=true`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Observations unavailable", outcome: "uncertain" });
    expect(filterCalls[0]).toEqual(["voided_at", "not.is", null]);
  });
});

describe("correct or void an asset observation", () => {
  const correct = { request_key: key, action: "correct", expected_version: 1, payload: { reason: "Run time misread", readings: { run_minutes: 32 } } };

  it("refuses a bad id, a malformed body and an unreadable or unheld observation before the command", async () => {
    expect((await COMMAND(post("https://local.test/o", correct), params("nope"))).status).toBe(404);
    const malformed = await COMMAND(post("https://local.test/o", { ...correct, expected_version: undefined }), params(observationId));
    expect(malformed.status).toBe(400);
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await COMMAND(post("https://local.test/o", correct), params(observationId))).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    expect((await COMMAND(post("https://local.test/o", correct), params(observationId))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await COMMAND(post("https://local.test/o", correct), params(observationId))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards a correction with its expected version and a void with its reason", async () => {
    rpc.mockResolvedValueOnce({ data: { ...outcome, delivery: { ...outcome.delivery, event: { ...outcome.delivery.event, state: "corrected" } } }, error: null });
    let response = await COMMAND(post("https://local.test/o", correct), params(observationId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("correct_asset_observation_review", { p_id: observationId, p_request_key: key, p_expected_version: 1, p_payload: correct.payload });
    expect((await response.json()).delivery.event.state).toBe("corrected");
    rpc.mockResolvedValueOnce({ data: { ...outcome, linked: false, delivery: { ...outcome.delivery, event: { ...outcome.delivery.event, state: "invalidated", attention: true } } }, error: null });
    response = await COMMAND(post("https://local.test/o", { request_key: key, action: "void", payload: { reason: "Wrong week" } }), params(observationId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("void_asset_observation_review", { p_id: observationId, p_request_key: key, p_payload: { reason: "Wrong week" } });
    const json = await response.json();
    expect(json.linked).toBe(false);
    expect(json.delivery.event.attention).toBe(true);
  });

  it("returns a stale expected version as a conflict naming the current one and a voided record as a conflict", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Record changed since it was read", details: "current_record_version=2" } });
    let response = await COMMAND(post("https://local.test/o", correct), params(observationId));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Record changed since it was read", outcome: "conflict", current_record_version: "2" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Observation is voided" } });
    response = await COMMAND(post("https://local.test/o", correct), params(observationId));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Observation is voided");
  });
});
