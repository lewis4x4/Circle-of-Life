import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/types/database";
import { fetchResidentAssuranceFacilityTrendSeries } from "./command-center-brief";

const tables = ["facilities", "resident_watch_instances", "resident_observation_escalations", "resident_observation_integrity_flags", "resident_safety_scores"];
type Reply = { data: unknown[] | null; error: { message: string } | null };

function fixture(overrides: Record<string, Reply> = {}, rejects: Record<string, Error> = {}) {
  const replies: Record<string, Reply> = {
    facilities: { data: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }], error: null },
    resident_watch_instances: { data: [{ facility_id: "a", starts_at: "2026-09-05T01:00:00Z" }, { facility_id: "a", starts_at: "2026-09-05T02:00:00Z" }], error: null },
    resident_observation_escalations: { data: [{ facility_id: "a", triggered_at: "2026-09-04T23:00:00Z" }], error: null },
    resident_observation_integrity_flags: { data: [{ facility_id: "a", detected_at: "2026-09-05T03:00:00Z" }], error: null },
    resident_safety_scores: { data: [
      { facility_id: "a", resident_id: "r1", risk_tier: "high", computed_at: "2026-09-05T06:00:00Z" },
      { facility_id: "a", resident_id: "r1", risk_tier: "critical", computed_at: "2026-09-05T05:00:00Z" },
      { facility_id: "a", resident_id: "r2", risk_tier: "critical", computed_at: "2026-09-05T04:00:00Z" },
    ], error: null },
    ...overrides,
  };
  const started: string[] = [];
  const operations: Record<string, unknown[][]> = {};
  const from = vi.fn((table: string) => {
    operations[table] = [];
    const query = {
      select: (value: string) => record("select", value),
      eq: (column: string, value: unknown) => record("eq", column, value),
      is: (column: string, value: unknown) => record("is", column, value),
      gte: (column: string, value: unknown) => record("gte", column, value),
      order: (column: string, value: unknown) => record("order", column, value),
      then: (resolve: (reply: Reply) => unknown, reject: (reason: unknown) => unknown) => {
        started.push(table);
        return new Promise<Reply>((res, rej) => setTimeout(() => {
          if (rejects[table]) rej(rejects[table]);
          else res(replies[table]);
        }, table === "facilities" ? 25 : 20)).then(resolve, reject);
      },
    };
    function record(...args: unknown[]) { operations[table].push(args); return query; }
    return query;
  });
  return { client: { from } as unknown as SupabaseClient<Database>, started, operations };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-05T12:00:00Z")); });
afterEach(() => vi.useRealTimers());

async function run(client: SupabaseClient<Database>) {
  const result = fetchResidentAssuranceFacilityTrendSeries(client, "org", 2);
  // Attach rejection handling before timers run.
  const outcome = result.then(value => ({ value }), error => ({ error }));
  await vi.runAllTimersAsync();
  return outcome;
}

describe("facility trend reads", () => {
  it("preserves daily counts, latest resident scores, facility order and empty days", async () => {
    const { client, operations } = fixture();
    const result = await run(client);
    const empty = { watchStarts: 0, escalations: 0, integrityFlags: 0, criticalResidents: 0, heatScore: 0, heatBand: "stable" };
    expect(result).toEqual({ value: [
      { facilityId: "a", facilityName: "Alpha", latestHeatScore: 9, peakHeatScore: 9, avgHeatScore: 6, points: [
        { ...empty, date: "2026-09-04", escalations: 1, heatScore: 3, heatBand: "watch" },
        { date: "2026-09-05", watchStarts: 2, escalations: 0, integrityFlags: 1, criticalResidents: 1, heatScore: 9, heatBand: "elevated" },
      ] },
      { facilityId: "b", facilityName: "Beta", latestHeatScore: 0, peakHeatScore: 0, avgHeatScore: 0, points: [
        { ...empty, date: "2026-09-04" }, { ...empty, date: "2026-09-05" },
      ] },
    ] });
    for (const table of tables) {
      expect(operations[table]).toContainEqual(["eq", "organization_id", "org"]);
      expect(operations[table]).toContainEqual(["is", "deleted_at", null]);
    }
    for (const [index, column] of ["starts_at", "triggered_at", "detected_at", "computed_at"].entries()) {
      expect(operations[tables[index + 1]]).toContainEqual(["gte", column, "2026-09-04T00:00:00.000Z"]);
    }
    expect(operations.resident_safety_scores).toContainEqual(["order", "computed_at", { ascending: false }]);
  });

  it("handles null datasets", async () => {
    const overrides = Object.fromEntries(tables.map(table => [table, { data: null, error: null }]));
    expect(await run(fixture(overrides).client)).toEqual({ value: [] });
  });

  it("retains response error priority when later queries finish first", async () => {
    const client = fixture({ facilities: { data: null, error: { message: "facility error" } }, resident_watch_instances: { data: null, error: { message: "watch error" } } }).client;
    expect(await run(client)).toEqual({ error: new Error("facility error") });
  });

  it("retains rejection priority ahead of response errors", async () => {
    const failure = new Error("watch rejected");
    const client = fixture({ facilities: { data: null, error: { message: "facility error" } } }, { resident_watch_instances: failure, resident_safety_scores: new Error("later rejection") }).client;
    expect(await run(client)).toEqual({ error: failure });
  });

  it("starts all reads together and completes in the slowest single-read delay", async () => {
    const { client, started } = fixture();
    const start = Date.now();
    const result = fetchResidentAssuranceFacilityTrendSeries(client, "org", 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(tables);
    await vi.runAllTimersAsync();
    await result;
    expect(Date.now() - start).toBe(25);
  });
});
