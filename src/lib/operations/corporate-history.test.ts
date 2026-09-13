import { describe, expect, it } from "vitest";
import { composeCorporateHistory, decodeCorporateHistoryCursor, encodeCorporateHistoryCursor } from "./corporate-history";
import type { OperationsActor } from "./auth";
const facility = "11111111-1111-4111-8111-111111111111", activity = "22222222-2222-4222-8222-222222222222";
const id = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;
const at = "2026-09-12T12:00:00.123456+00:00";
const now = new Date("2026-09-13T00:00:00Z");
function fixture(size = 1103, fail = "", receiptRows: Record<string, unknown>[] = [], profiles: Record<string, unknown>[] = []) {
  const rows = Array.from({ length: size }, (_, index) => ({ id: id(index), activity_id: activity, created_at: at, template_name: "Generator check", status: index % 2 ? "completed" : "cancelled", requirement_version_id: index % 2 ? "old" : "new", effective_receipt_id: null, due_at: null }));
  const reads: { table: string; filters: unknown[][] }[] = [];
  const client = { from(table: string) {
    const filters: unknown[][] = []; reads.push({ table, filters });
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "not", "or", "order", "lte", "gte", "in", "limit", "range"]) chain[method] = (...args: unknown[]) => { filters.push([method, ...args]); return chain; };
    chain.neq = (...args: unknown[]) => { filters.push(["neq", ...args]); return chain; };
    const result = () => {
      if (table === fail) return { data: null, error: { message: "failed" } };
      if (table === "facilities") return { data: { name: "Homewood", timezone: "America/New_York" }, error: null };
      let data: unknown[] = table === "operation_activities" ? [{ id: activity, name: "Generator check" }] : table === "operation_task_instances" ? [...rows].reverse() : table === "operation_execution_receipts" ? [...receiptRows] : table === "user_profiles" ? profiles : [];
      if ((filters.find((f) => f[0] === "select")?.[2] as { head?: boolean })?.head) return { data: null, count: table === "operation_task_instances" ? rows.length : 0, error: null };
      if (filters.some((f) => f[0] === "gte")) data = [];
      const key = filters.find((f) => f[0] === "or" && String(f[1]).startsWith("created_at"));
      if (key) { const tail = String(key[1]).match(/id.lt.([^)]*)/)?.[1]; data = data.filter((row) => (row as { id: string }).id < (tail ?? "")); }
      if (table === "operation_execution_receipts") {
        for (const filter of filters) {
          if (filter[0] === "eq" && ["receipt_kind", "outcome"].includes(String(filter[1]))) data = data.filter((row) => (row as Record<string, unknown>)[String(filter[1])] === filter[2]);
          if (filter[0] === "is") data = data.filter((row) => (row as Record<string, unknown>)[String(filter[1])] === filter[2]);
        }
        data.sort((a, b) => String((b as Record<string, unknown>).performed_at).localeCompare(String((a as Record<string, unknown>).performed_at)));
        const limit = filters.find((filter) => filter[0] === "limit"); if (limit) data = data.slice(0, Number(limit[1]));
      }
      const range = filters.find((f) => f[0] === "range");
      if (range) data = data.slice(Number(range[1]), Math.min(Number(range[2]) + 1, Number(range[1]) + 17));
      return { data, error: null };
    };
    chain.maybeSingle = () => Promise.resolve(result());
    chain.then = (resolve: (data: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return chain;
  } };
  return { actor: { id: id(9999), organizationId: "org", currentActor: { client } } as unknown as OperationsActor, reads };
}
describe("corporate activity history", () => {
  it("preserves microseconds and refuses cross-activity/site cursors", () => {
    const row = { facility, activity, at, id: id(1), as_of: now.toISOString() };
    const token = encodeCorporateHistoryCursor(row);
    expect(decodeCorporateHistoryCursor(token, facility, activity)).toEqual(row);
    expect(decodeCorporateHistoryCursor(token, id(4), activity)).toBeNull();
    expect(decodeCorporateHistoryCursor(token, facility, id(4))).toBeNull();
    expect(decodeCorporateHistoryCursor("@@@@", facility, activity)).toBeNull();
  });
  it("pages over 1000 tied timestamps across revisions despite a provider cap below page size", async () => {
    const { actor, reads } = fixture();
    let cursor: string | null = null;
    const seen: string[] = [];
    do {
      const outcome = await composeCorporateHistory({ actor, facilityId: facility, activityId: activity, cursor, now });
      expect(outcome.status).toBe(200);
      if (outcome.status !== 200) throw new Error(outcome.error);
      expect(outcome.body.total).toBe(1103);
      seen.push(...outcome.body.history.map((row) => row.id)); cursor = outcome.body.next_cursor;
    } while (cursor);
    expect(seen).toHaveLength(1103); expect(new Set(seen).size).toBe(1103);
    expect(seen[0]).toBe(id(1102)); expect(seen.at(-1)).toBe(id(0));
    for (const read of reads.filter((read) => read.table === "operation_task_instances")) {
      expect(read.filters).toContainEqual(["eq", "facility_id", facility]);
      expect(read.filters).toContainEqual(["eq", "activity_id", activity]);
      expect(read.filters).toContainEqual(["eq", "organization_id", "org"]);
    }
  });
  it("distinguishes confirmed empty history and unknown schedule from primary failure", async () => {
    const empty = await composeCorporateHistory({ ...fixture(0), facilityId: facility, activityId: activity, cursor: null, now });
    expect(empty).toMatchObject({ status: 200, body: { history: [], total: 0, schedule_status: "unknown", partial: [] } });
    const failed = await composeCorporateHistory({ ...fixture(0, "operation_task_instances"), facilityId: facility, activityId: activity, cursor: null, now });
    expect(failed.status).toBe(503);
  });
  it("finds the latest effective performance outside the occurrence page, excluding superseded work", async () => {
    const receipt = { id: id(3000), task_instance_id: id(1), receipt_kind: "performance", outcome: "performed", performed_at: "2026-09-12T14:00:00Z", superseded_by_receipt_id: null };
    const { actor } = fixture(1103, "", [receipt, { ...receipt, id: id(3001), performed_at: "2026-09-12T15:00:00Z", superseded_by_receipt_id: id(3002) }]);
    const outcome = await composeCorporateHistory({ actor, facilityId: facility, activityId: activity, cursor: null, now });
    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) throw new Error(outcome.error);
    expect(outcome.body.history.some((row) => row.id === receipt.task_instance_id)).toBe(false);
    expect(outcome.body.last_receipt).toEqual(receipt);
  });
  it("hydrates current recorder and performer names without replacing the historical label", async () => {
    const receipt = { id: id(3000), recorder_id: id(7), performer_user_id: id(8), performer_kind: "other_staff", performer_label: "Original label", receipt_kind: "performance", outcome: "performed", performed_at: "2026-09-12T14:00:00Z", superseded_by_receipt_id: null };
    const outcome = await composeCorporateHistory({ ...fixture(0, "", [receipt], [{ id: id(7), full_name: "Sam Recorder" }, { id: id(8), full_name: "Pat Performer" }]), facilityId: facility, activityId: activity, cursor: null, now });
    expect(outcome).toMatchObject({ status: 200, body: { partial: [], last_receipt: { recorder_name: "Sam Recorder", performer_name: "Pat Performer", performer_label: "Original label" } } });
    const unavailable = await composeCorporateHistory({ ...fixture(0, "user_profiles", [receipt]), facilityId: facility, activityId: activity, cursor: null, now });
    expect(unavailable).toMatchObject({ status: 200, body: { partial: ["people"], last_receipt: { recorder_name: null, performer_name: null } } });
  });
  it("reports ancillary failures explicitly", async () => {
    const outcome = await composeCorporateHistory({ ...fixture(1, "operation_issues"), facilityId: facility, activityId: activity, cursor: null, now });
    expect(outcome).toMatchObject({ status: 200, body: { open_issues: null, partial: ["issues"] } });
  });
});
