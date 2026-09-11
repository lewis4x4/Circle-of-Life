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
const vendorId = "99999999-9999-4999-8999-999999999999";
const recordId = "88888888-8888-4888-8888-888888888888";
const key = "svc:2026-09-10:0001";
const payload = { facility_id: facilityId, service_kind: "extinguisher_inspection", asset_id: assetId, performed_at: "2026-09-10T14:00:00-04:00", performer_kind: "vendor", vendor_id: vendorId, outcome: "pass", entry_reason: "Vendor visit", next_due_on: "2027-09-10" };
const post = (url: string, body: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const outcome = {
  record: { id: recordId, record_version: 1, facility_id: facilityId, service_kind: "extinguisher_inspection", finalized_at: "2026-09-10T18:05:00Z" },
  delivery: {
    event: { id: "66666666-6666-4666-8666-666666666666", state: "satisfied", attention: false, request_hash: "f".repeat(64) },
    occurrence: { id: "55555555-5555-4555-8555-555555555555", status: "completed" },
    receipt: { id: "77777777-7777-4777-8777-777777777777", request_hash: "f".repeat(64), performer_kind: "vendor" },
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
  maybeSingle.mockResolvedValue({ data: { id: recordId, facility_id: facilityId, organization_id: "org" }, error: null });
});

describe("record a facility service", () => {
  it("refuses a malformed body, a facility kind with an asset and a vendor without a vendor before any command, and treats an unheld site as missing", async () => {
    let response = await RECORD(post("https://local.test/service-records", { request_key: key, payload: { ...payload, service_kind: "elevator_inspection" } }));
    expect(response.status).toBe(400);
    expect((await response.json()).outcome).toBe("validation");
    response = await RECORD(post("https://local.test/service-records", { request_key: key, payload: { ...payload, service_kind: "fire_safety_inspection" } }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("fire_safety_inspection is recorded against the site, not an asset");
    response = await RECORD(post("https://local.test/service-records", { request_key: key, payload: { ...payload, vendor_id: undefined } }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("vendor_id must be set for a vendor performer");
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    response = await RECORD(post("https://local.test/service-records", { request_key: key, payload }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Facility not found", outcome: "missing" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards the request key and payload, revalidates the actor, and returns the record with the delivery stripped of idempotency material", async () => {
    rpc.mockResolvedValueOnce({ data: outcome, error: null });
    const response = await RECORD(post("https://local.test/service-records", { request_key: key, payload }));
    expect(response.status).toBe(200);
    expect(revalidateOperationsActor).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("record_facility_service_review", { p_request_key: key, p_payload: payload });
    const body = await response.json();
    expect(body.outcome).toBe("record");
    expect(body.record).toEqual(outcome.record);
    expect(body.delivery.event).toEqual({ id: "66666666-6666-4666-8666-666666666666", state: "satisfied", attention: false });
    expect(body.delivery.receipt).toEqual({ id: "77777777-7777-4777-8777-777777777777", performer_kind: "vendor" });
    expect(body.linked).toBe(true);
  });

  it("maps the database outcome classes: refusals by name, a denial, a replay conflict and uncertainty", async () => {
    for (const message of [
      "Performer vendor is not linked to this site",
      "A hood cleaning is recorded against a hood suppression system or kitchen equipment",
      "Certificate is not a current document of this site",
      "next_due_on must be after the service date",
      "Work performed by someone else must be entered on behalf with a reason",
    ]) {
      rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message } });
      const response = await RECORD(post("https://local.test/service-records", { request_key: key, payload }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: message, outcome: "validation" });
    }
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Operation unavailable" } });
    let response = await RECORD(post("https://local.test/service-records", { request_key: key, payload }));
    expect(response.status).toBe(403);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "This request was already saved with different content" } });
    response = await RECORD(post("https://local.test/service-records", { request_key: key, payload }));
    expect(response.status).toBe(409);
    rpc.mockResolvedValueOnce({ data: { record: { id: recordId } }, error: null });
    response = await RECORD(post("https://local.test/service-records", { request_key: key, payload }));
    expect(response.status).toBe(500);
    expect((await response.json()).outcome).toBe("uncertain");
  });
});

describe("list facility services", () => {
  it("requires a held site and reads beyond the provider cap to an exact total with the requested filters", async () => {
    let response = await LIST(new NextRequest("https://local.test/service-records"));
    expect(response.status).toBe(400);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    response = await LIST(new NextRequest(`https://local.test/service-records?facility_id=${facilityId}`));
    expect(response.status).toBe(404);
    readCap = 3;
    listRows = Array.from({ length: 7 }, (_, index) => ({ id: `s${index}` }));
    response = await LIST(new NextRequest(`https://local.test/service-records?facility_id=${facilityId}&kind=hood_cleaning&asset_id=${assetId}&voided=false`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(7);
    expect(body.records.map((row: { id: string }) => row.id)).toEqual(["s0", "s1", "s2", "s3", "s4", "s5", "s6"]);
    expect(readRanges).toEqual([0, 3, 6, 7]);
    expect(eqCalls.slice(0, 4)).toEqual([["organization_id", "org"], ["facility_id", facilityId], ["service_kind", "hood_cleaning"], ["asset_id", assetId]]);
    expect(filterCalls[0]).toEqual(["voided_at", "is", null]);
    expect(orders.slice(0, 2)).toEqual([["performed_at", { ascending: false }], ["id", { ascending: true }]]);
  });

  it("reports a failed later page as unavailable rather than a shorter list", async () => {
    readCap = 2;
    failPageAt = 2;
    listRows = Array.from({ length: 5 }, (_, index) => ({ id: `s${index}` }));
    const response = await LIST(new NextRequest(`https://local.test/service-records?facility_id=${facilityId}&voided=true`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Service records unavailable", outcome: "uncertain" });
    expect(filterCalls[0]).toEqual(["voided_at", "not.is", null]);
  });
});

describe("correct or void a facility service", () => {
  const correct = { request_key: key, action: "correct", expected_version: 1, payload: { reason: "Tag year misread", readings: { tag_year: 2025 } } };

  it("refuses a bad id, a malformed body and an unreadable, foreign or unheld record before the command", async () => {
    expect((await COMMAND(post("https://local.test/s", correct), params("nope"))).status).toBe(404);
    const malformed = await COMMAND(post("https://local.test/s", { ...correct, expected_version: undefined }), params(recordId));
    expect(malformed.status).toBe(400);
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await COMMAND(post("https://local.test/s", correct), params(recordId))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: { id: recordId, facility_id: facilityId, organization_id: "other" }, error: null });
    expect((await COMMAND(post("https://local.test/s", correct), params(recordId))).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    expect((await COMMAND(post("https://local.test/s", correct), params(recordId))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await COMMAND(post("https://local.test/s", correct), params(recordId))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards a correction with its expected version and a void with its reason", async () => {
    rpc.mockResolvedValueOnce({ data: { ...outcome, delivery: { ...outcome.delivery, event: { ...outcome.delivery.event, state: "corrected" } } }, error: null });
    let response = await COMMAND(post("https://local.test/s", correct), params(recordId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("correct_facility_service_review", { p_id: recordId, p_request_key: key, p_expected_version: 1, p_payload: correct.payload });
    expect((await response.json()).delivery.event.state).toBe("corrected");
    rpc.mockResolvedValueOnce({ data: { ...outcome, linked: false, delivery: { ...outcome.delivery, event: { ...outcome.delivery.event, state: "invalidated", attention: true } } }, error: null });
    response = await COMMAND(post("https://local.test/s", { request_key: key, action: "void", payload: { reason: "Wrong unit" } }), params(recordId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("void_facility_service_review", { p_id: recordId, p_request_key: key, p_payload: { reason: "Wrong unit" } });
    const json = await response.json();
    expect(json.linked).toBe(false);
    expect(json.delivery.event.attention).toBe(true);
  });

  it("returns a stale expected version as a conflict naming the current one, a voided record as a conflict, and a kind change as validation", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Record changed since it was read", details: "current_record_version=2" } });
    let response = await COMMAND(post("https://local.test/s", correct), params(recordId));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Record changed since it was read", outcome: "conflict", current_record_version: "2" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Service record is voided" } });
    response = await COMMAND(post("https://local.test/s", correct), params(recordId));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Service record is voided");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Service kind cannot change; void the record and record it again" } });
    response = await COMMAND(post("https://local.test/s", correct), params(recordId));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Service kind cannot change; void the record and record it again");
  });
});
