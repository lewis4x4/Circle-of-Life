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
const actor = { id: "actor", organizationId: "org", appRole: "dietary", currentActor: { client: { rpc, from } } };
const facilityId = "33333333-3333-4333-8333-333333333333";
const recordId = "88888888-8888-4888-8888-888888888888";
const key = "diet:2026-09-10:0001";
const payload = { facility_id: facilityId, record_kind: "meal_substitution", performed_at: "2026-09-10T12:10:00-04:00", service_date: "2026-09-10", meal_period: "lunch", planned_item: "Baked chicken", substitute_item: "Turkey loaf", substitution_reason: "Delivery short" };
const post = (url: string, body: unknown) => new NextRequest(url, { method: "POST", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const outcome = {
  record: { id: recordId, record_version: 1, facility_id: facilityId, record_kind: "meal_substitution", finalized_at: "2026-09-10T16:15:00Z" },
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
  maybeSingle.mockResolvedValue({ data: { id: recordId, facility_id: facilityId, organization_id: "org" }, error: null });
});

describe("record a dietary record", () => {
  it("refuses a malformed body, an incomplete substitution, a failed approval and a menu field on a food check before any command, and treats an unheld site as missing", async () => {
    let response = await RECORD(post("https://local.test/dietary-records", { request_key: key, payload: { ...payload, record_kind: "pantry_check" } }));
    expect(response.status).toBe(400);
    response = await RECORD(post("https://local.test/dietary-records", { request_key: key, payload: { ...payload, substitute_item: undefined } }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("service_date, meal_period, planned_item, substitute_item and substitution_reason are required for a meal substitution");
    response = await RECORD(post("https://local.test/dietary-records", { request_key: key, payload: { facility_id: facilityId, record_kind: "menu_approval", performed_at: payload.performed_at, menu_label: "Fall cycle", approver_label: "RD", outcome: "failed", issue_summary: "x" } }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("A menu approval is recorded as performed; state a problem as an issue summary");
    response = await RECORD(post("https://local.test/dietary-records", { request_key: key, payload: { facility_id: facilityId, record_kind: "emergency_food_supply_check", performed_at: payload.performed_at, menu_label: "x" } }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("meal and menu fields must be empty for an emergency food supply check");
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    response = await RECORD(post("https://local.test/dietary-records", { request_key: key, payload }));
    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards the request key and payload and returns the record with its link verdict", async () => {
    rpc.mockResolvedValueOnce({ data: outcome, error: null });
    const response = await RECORD(post("https://local.test/dietary-records", { request_key: key, payload }));
    expect(response.status).toBe(200);
    expect(revalidateOperationsActor).toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("record_dietary_record_review", { p_request_key: key, p_payload: payload });
    const body = await response.json();
    expect(body.outcome).toBe("record");
    expect(body.delivery.receipt).toEqual({ id: "77777777-7777-4777-8777-777777777777" });
    expect(body.linked).toBe(true);
  });

  it("maps the meal-level refusals by name, a denial and uncertainty", async () => {
    for (const message of ["A meal substitution is recorded on its service date", "Meal service must be this site's service for that date and period", "Approval document is not a current document of this site"]) {
      rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message } });
      const response = await RECORD(post("https://local.test/dietary-records", { request_key: key, payload }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: message, outcome: "validation" });
    }
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Operation unavailable" } });
    let response = await RECORD(post("https://local.test/dietary-records", { request_key: key, payload }));
    expect(response.status).toBe(403);
    rpc.mockResolvedValueOnce({ data: { record: { id: recordId } }, error: null });
    response = await RECORD(post("https://local.test/dietary-records", { request_key: key, payload }));
    expect(response.status).toBe(500);
  });
});

describe("list dietary records", () => {
  it("requires a held site and reads beyond the provider cap to an exact total with the requested filters", async () => {
    let response = await LIST(new NextRequest("https://local.test/dietary-records"));
    expect(response.status).toBe(400);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    response = await LIST(new NextRequest(`https://local.test/dietary-records?facility_id=${facilityId}`));
    expect(response.status).toBe(404);
    readCap = 2;
    listRows = Array.from({ length: 5 }, (_, index) => ({ id: `d${index}` }));
    response = await LIST(new NextRequest(`https://local.test/dietary-records?facility_id=${facilityId}&kind=meal_substitution&voided=false`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(5);
    expect(readRanges).toEqual([0, 2, 4, 5]);
    expect(eqCalls.slice(0, 3)).toEqual([["organization_id", "org"], ["facility_id", facilityId], ["record_kind", "meal_substitution"]]);
    expect(filterCalls[0]).toEqual(["voided_at", "is", null]);
    expect(orders.slice(0, 2)).toEqual([["performed_at", { ascending: false }], ["id", { ascending: true }]]);
  });

  it("reports a failed later page as unavailable rather than a shorter list", async () => {
    readCap = 2;
    failPageAt = 2;
    listRows = Array.from({ length: 5 }, (_, index) => ({ id: `d${index}` }));
    const response = await LIST(new NextRequest(`https://local.test/dietary-records?facility_id=${facilityId}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Dietary records unavailable", outcome: "uncertain" });
  });
});

describe("correct or void a dietary record", () => {
  const correct = { request_key: key, action: "correct", expected_version: 1, payload: { reason: "Item misnamed", substitute_item: "Turkey meatloaf" } };

  it("refuses a bad id, a malformed body and an unreadable or unheld record before the command", async () => {
    expect((await COMMAND(post("https://local.test/d", correct), params("nope"))).status).toBe(404);
    expect((await COMMAND(post("https://local.test/d", { ...correct, payload: { substitute_item: "x" } }), params(recordId))).status).toBe(400);
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect((await COMMAND(post("https://local.test/d", correct), params(recordId))).status).toBe(404);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    expect((await COMMAND(post("https://local.test/d", correct), params(recordId))).status).toBe(404);
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await COMMAND(post("https://local.test/d", correct), params(recordId))).status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("forwards a correction and a void, and maps a stale version, a voided record and a kind change", async () => {
    rpc.mockResolvedValueOnce({ data: { ...outcome, delivery: { ...outcome.delivery, event: { ...outcome.delivery.event, state: "corrected" } } }, error: null });
    let response = await COMMAND(post("https://local.test/d", correct), params(recordId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("correct_dietary_record_review", { p_id: recordId, p_request_key: key, p_expected_version: 1, p_payload: correct.payload });
    rpc.mockResolvedValueOnce({ data: { ...outcome, linked: false, delivery: { ...outcome.delivery, event: { ...outcome.delivery.event, state: "invalidated", attention: true } } }, error: null });
    response = await COMMAND(post("https://local.test/d", { request_key: key, action: "void", payload: { reason: "Counted the wrong shelf" } }), params(recordId));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith("void_dietary_record_review", { p_id: recordId, p_request_key: key, p_payload: { reason: "Counted the wrong shelf" } });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Record changed since it was read", details: "current_record_version=3" } });
    response = await COMMAND(post("https://local.test/d", correct), params(recordId));
    expect(response.status).toBe(409);
    expect((await response.json()).current_record_version).toBe("3");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Dietary record is voided" } });
    expect((await COMMAND(post("https://local.test/d", correct), params(recordId))).status).toBe(409);
    rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "Record kind cannot change; void the record and record it again" } });
    response = await COMMAND(post("https://local.test/d", correct), params(recordId));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Record kind cannot change; void the record and record it again");
  });
});
