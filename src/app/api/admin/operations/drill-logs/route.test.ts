import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/operations/auth", () => ({ requireOperationsActor: vi.fn(), revalidateOperationsActor: vi.fn(), actorCanAccessFacility: vi.fn() }));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { GET as LIST } from "./route";
import { actorCanAccessFacility, requireOperationsActor } from "@/lib/operations/auth";

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
  return query;
});
const actor = { id: "actor", organizationId: "org", appRole: "facility_admin", currentActor: { client: { from } } };
const facilityId = "33333333-3333-4333-8333-333333333333";
const url = (query: string) => new NextRequest(`https://local.test/drill-logs?${query}`);

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
  vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
});

describe("list drill logs", () => {
  it("requires a site it holds and refuses an unknown state or drill type", async () => {
    expect((await LIST(url(""))).status).toBe(400);
    expect((await LIST(url(`facility_id=${facilityId}&state=complete`))).status).toBe(400);
    expect((await LIST(url(`facility_id=${facilityId}&drill_type=hurricane`))).status).toBe(400);
    vi.mocked(actorCanAccessFacility).mockResolvedValueOnce(false);
    const denied = await LIST(url(`facility_id=${facilityId}`));
    expect(denied.status).toBe(404);
    expect(await denied.json()).toEqual({ error: "Facility not found", outcome: "missing" });
    expect(from).not.toHaveBeenCalled();
  });

  it("reads drafts of one drill type beyond the provider cap to an exact total, newest first", async () => {
    readCap = 2;
    listRows = Array.from({ length: 5 }, (_, index) => ({ id: `d${index}` }));
    const response = await LIST(url(`facility_id=${facilityId}&drill_type=fire&state=draft`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(5);
    expect(body.drill_logs.map((row: { id: string }) => row.id)).toEqual(["d0", "d1", "d2", "d3", "d4"]);
    expect(body.drill_type).toBe("fire");
    expect(body.state).toBe("draft");
    expect(readRanges).toEqual([0, 2, 4, 5]);
    // Each page rebuilds the same scoped query, so the first page's filters are the contract.
    expect(eqCalls.slice(0, 3)).toEqual([["organization_id", "org"], ["facility_id", facilityId], ["drill_type", "fire"]]);
    // Soft-deleted rows are excluded, and a draft is exactly a row with no finalization.
    expect(filterCalls.slice(0, 2)).toEqual([["deleted_at", "is", null], ["finalized_at", "is", null]]);
    expect(orders.slice(0, 3)).toEqual([["drill_date", { ascending: false }], ["drill_time", { ascending: false }], ["id", { ascending: true }]]);
  });

  it("separates final from voided so neither state is inferred from the other", async () => {
    await LIST(url(`facility_id=${facilityId}&state=final`));
    expect(filterCalls).toEqual([["deleted_at", "is", null], ["finalized_at", "not.is", null], ["voided_at", "is", null]]);
    filterCalls.length = 0;
    await LIST(url(`facility_id=${facilityId}&state=voided`));
    expect(filterCalls).toEqual([["deleted_at", "is", null], ["voided_at", "not.is", null]]);
  });

  it("reports a failed later page as unavailable rather than a shorter list", async () => {
    readCap = 2;
    failPageAt = 2;
    listRows = Array.from({ length: 5 }, (_, index) => ({ id: `d${index}` }));
    const response = await LIST(url(`facility_id=${facilityId}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Drill logs unavailable", outcome: "uncertain" });
    expect(logError).toHaveBeenCalled();
  });
});
