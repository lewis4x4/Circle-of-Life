import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/types/database";
import { saveStandupMetricInput, generateExecutiveStandupDraft, buildStandupComparison, buildStandupNarrative, hasRecordedPressure, type StandupSnapshotDetail, STANDUP_METRIC_DEFINITIONS } from "./standup";
import { canCompareStandupMetrics, qualifyStandupValue, readStandupSourceQuality, standupCoverageLabel, type StandupSourceQuality } from "./standup-quality";

const when = "2026-09-08T14:00:00.000Z";
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const quality = (overrides: Partial<StandupSourceQuality> = {}): StandupSourceQuality => ({
  kind: "source_quality", version: 1, calculated_at: when, source_as_of: null, received_at: null,
  query_complete: true, period_coverage: "unconfirmed", expected_facility_ids: [a,b], contributing_facility_ids: [a,b], basis: "haven_live_v1", ...overrides,
});
const metric = (q: StandupSourceQuality | null = quality(), value = 0) => ({ key: "current_ar_cents", valueType: "currency", valueNumeric: value, valueText: null, sourceRefJson: q ? [{ table: "invoices" }, q] : [{ table: "invoices" }] });

afterEach(() => vi.useRealTimers());

describe("standup source quality", () => {
  it("qualifies a recorded zero without claiming source freshness or period completeness", () => {
    expect(qualifyStandupValue(metric(), "$0")).toBe("$0 recorded");
    expect(standupCoverageLabel(metric())).toBe("Coverage unconfirmed");
    expect(readStandupSourceQuality(metric())).toMatchObject({ source_as_of: null, received_at: null, period_coverage: "unconfirmed" });
  });
  it("keeps legacy metadata unknown and rejects malformed or contradictory scope", () => {
    expect(readStandupSourceQuality(metric(null))).toBeNull();
    expect(standupCoverageLabel(metric(null))).toBe("Coverage unconfirmed");
    for (const invalid of [{ version: 2 }, { query_complete: "true" }, { calculated_at: "today" }, { period_coverage: "complete" },
      { expected_facility_ids: [a,a] }, { contributing_facility_ids: ["foreign"] }, { basis: { toString: null, valueOf: null } }]) {
      expect(readStandupSourceQuality({ sourceRefJson: [{ ...quality(), ...invalid }] })).toBeNull();
    }
    expect(readStandupSourceQuality({ sourceRefJson: [quality(), { kind: "source_quality", version: 3 }] })).toBeNull();
  });
  it("qualifies partial subtotals and preserves operator text verbatim", () => {
    const partial = metric(quality({ contributing_facility_ids: [a] }), 12);
    expect(qualifyStandupValue(partial, "12")).toBe("12 — partial 1/2");
    expect(standupCoverageLabel(partial)).toBe("Partial: 1 of 2 facilities");
    expect(qualifyStandupValue({ ...partial, valueText: "Pending Jessica review" }, "12")).toBe("Pending Jessica review");
    expect(qualifyStandupValue({ ...metric(), valueText: "" }, "$0")).toBe("$0 recorded");
    expect(qualifyStandupValue({ ...metric(), valueText: "  " }, "$0")).toBe("$0 recorded");
    expect(canCompareStandupMetrics({ ...metric(), valueText: "" }, { ...metric(), valueText: "  " })).toBe(true);
  });
  it("only compares full matching recorded live scopes", () => {
    expect(canCompareStandupMetrics({ ...metric(), key: "census" }, metric())).toBe(false);
    expect(canCompareStandupMetrics({ ...metric(), valueType: "count" }, metric())).toBe(false);
    expect(canCompareStandupMetrics({ ...metric(), key: undefined }, metric())).toBe(false);
    expect(canCompareStandupMetrics({ ...metric(), valueType: "" }, metric())).toBe(false);
    expect(canCompareStandupMetrics(metric(), metric(quality({ expected_facility_ids: [b,a], calculated_at: "2026-09-15T14:00:00Z" })))).toBe(true);
    for (const q of [null, quality({ contributing_facility_ids: [a] }), quality({ expected_facility_ids: [a], contributing_facility_ids: [a] }),
      quality({ expected_facility_ids: null }), quality({ query_complete: false }), quality({ basis: "manual" }), quality({ basis: "mixed" }), quality({ basis: "unknown" })]) {
      expect(canCompareStandupMetrics(metric(), metric(q))).toBe(false);
    }
  });
  it("warns about high-confidence legacy data without inventing zero capacity or operational recommendations", () => {
    const facility = { facilityId: a, facilityName: "Legacy", pressureScore: 0, topConcern: "No bed availability",
      metrics: Object.fromEntries(STANDUP_METRIC_DEFINITIONS.map((definition) => [definition.key, { ...metric(null,0), ...definition, confidenceBand: "high", freshnessAt: null, overrideNote: null }])) };
    facility.metrics.current_ar_cents.valueNumeric = 20000000;
    const detail = { snapshot: { weekOf: "2026-09-07" }, facilities: [facility] } as StandupSnapshotDetail;
    const narrative = buildStandupNarrative(detail,null);
    expect(narrative.dataQuality.join(" ")).toMatch(/legacy source metadata/);
    expect(narrative.dataQuality.join(" ")).toMatch(/coverage remain unconfirmed/);
    expect(hasRecordedPressure(detail.facilities[0])).toBe(false);
    expect(narrative.headline).not.toMatch(/highest/);
    expect(narrative.bullets.join(" ")).not.toMatch(/no open bed capacity|highest open AR/);
    expect(narrative.facilityActions[0].whyRed.join(" ")).toMatch(/Source scope is incomplete or unknown/);
    expect(narrative.actions.join(" ")).not.toMatch(/Maintain current|release blocked|Escalate staffing/);
    expect(narrative.actions.join(" ")).toMatch(/confirm source coverage/);
  });

  it("does not invent a greatest change when comparable pressure scores are unchanged", () => {
    const facility = { facilityId: a, facilityName: "Recorded", pressureScore: 2, topConcern: "Recorded score",
      metrics: Object.fromEntries(STANDUP_METRIC_DEFINITIONS.map((definition) => [definition.key, { ...metric(quality(),0), ...definition, confidenceBand: "high", freshnessAt: null, overrideNote: null }])) };
    const detail = { snapshot: { weekOf: "2026-09-07" }, facilities: [facility] } as StandupSnapshotDetail;
    expect(hasRecordedPressure(detail.facilities[0])).toBe(true);
    expect(buildStandupComparison(detail,detail).headline).toBe("No recorded pressure change among comparable facilities.");
    expect(buildStandupNarrative(detail,null).dataQuality.join(" ")).toMatch(/coverage remain unconfirmed/);
    const unknown = { ...facility, facilityId: b, metrics: Object.fromEntries(Object.entries(facility.metrics).map(([key,value]) => [key,{ ...value,sourceRefJson: [] }])) };
    const mixed = { ...detail,facilities: [...detail.facilities,unknown] } as StandupSnapshotDetail;
    expect(buildStandupComparison(mixed,mixed).headline).toContain("Other facility comparisons are unavailable.");
  });

  it("suppresses legacy and partial metric and pressure change narratives", () => {
    const detail = (q: StandupSourceQuality | null, value: number) => ({ snapshot: { weekOf: "2026-09-07" }, facilities: [a,null].map((id) => ({
      facilityId: id, facilityName: id ? "Facility" : "Totals", pressureScore: value, topConcern: "Recorded concern",
      metrics: Object.fromEntries(STANDUP_METRIC_DEFINITIONS.map((definition) => [definition.key, { ...definition, ...metric(q,value), confidenceBand: "high", freshnessAt: null, overrideNote: null }])),
    })) } as StandupSnapshotDetail);
    const result = buildStandupComparison(detail(null, 5), detail(quality({ contributing_facility_ids: [a] }), 10));
    expect(result.headline).toMatch(/Comparison unavailable/);
    expect(result.facilityComparisons[0].pressureDelta).toBeNull();
    expect(result.facilityComparisons[0].comparisonAvailable).toBe(false);
    expect(result.facilityComparisons[0].concernFrom).toMatch(/unavailable/);
    expect(result.facilityComparisons[0].concernTo).toMatch(/unavailable/);
    expect(result.portfolioDeltas.every((line) => /comparison unavailable/.test(line))).toBe(true);
  });
});

type Row = Record<string, unknown>;
function persistenceClient(scope: string[] | null) {
  const rows: Row[] = [
    { id: "row-a", snapshot_id: "snapshot", organization_id: "org", facility_id: a, metric_key: "current_ar_cents", value_numeric: 50, value_text: null, deleted_at: null,
      source_ref_json: [{ table: "invoices" }, quality({ expected_facility_ids: [a], contributing_facility_ids: [a] })] },
    { id: "row-b", snapshot_id: "snapshot", organization_id: "org", facility_id: b, metric_key: "current_ar_cents", value_numeric: 70, value_text: null, deleted_at: null,
      source_ref_json: [{ table: "invoices" }, quality({ expected_facility_ids: [b], contributing_facility_ids: [b] })] },
    { id: "row-total", snapshot_id: "snapshot", organization_id: "org", facility_id: null, metric_key: "current_ar_cents", value_numeric: 120, value_text: null, deleted_at: null,
      source_ref_json: [{ mode: "old_rollup" }, quality()] },
  ];
  const header: Row = { id: "snapshot", organization_id: "org", deleted_at: null, summary_json: scope ? { source_facility_ids: scope } : {} };
  const queries: Array<{ table: string; offset: number }> = [];
  const client = { from(table: string) {
    const filters: Array<(row: Row) => boolean> = []; let offset = 0; let payload: Row | null = null; let action = "select";
    const data = table === "exec_standup_snapshot_metrics" ? rows : table === "exec_standup_snapshots" ? [header] : [];
    const execute = () => {
      queries.push({ table, offset });
      const matches = data.filter((row) => filters.every((filter) => filter(row))).sort((x,y) => String(x.id).localeCompare(String(y.id)));
      if (action === "update") { for (const row of matches) Object.assign(row, payload); return { data: null, error: null }; }
      if (action === "insert") { data.push({ ...payload }); return { data: null, error: null }; }
      if (action === "upsert") return { data: null, error: null };
      return { data: matches.slice(offset,offset+1), error: null }; // Server cap is one, even when client requests1000.
    };
    const query = {
      select() { return query; }, eq(column: string,value: unknown) { filters.push((row) => row[column] === value); return query; },
      is(column: string,value: unknown) { filters.push((row) => row[column] === value); return query; },
      order() { return query; }, range(from: number) { offset = from; return query; },
      update(value: Row) { action="update";payload=value;return query; }, insert(value: Row) { action="insert";payload=value;return query; },
      upsert(value: Row) { action="upsert";payload=value;return query; },
      single() { const result=execute();return Promise.resolve({ ...result,data: result.data?.[0] ?? null }); },
      maybeSingle() { return query.single(); }, then(resolve: (value: unknown) => unknown) { return Promise.resolve(execute()).then(resolve); },
    };
    return query;
  } } as unknown as SupabaseClient<Database>;
  return { client,rows,header,queries };
}

describe("generated standup source scope", () => {
  it("persists the captured facility scope and row provenance without claiming source freshness", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });vi.setSystemTime(new Date(when));
    const writes: Array<{ table: string; payload: unknown }> = [];
    const client = { from(table: string) {
      let inserting = false;let offset = 0;
      const result = () => ({ data: inserting ? { id: "new-snapshot", status: "draft" } : table === "facilities" && offset === 0
        ? [{ id: a, name: "Captured facility", total_licensed_beds: 10 }] : [], error: null });
      const query = {
        select() { return query; },eq() { return query; },is() { return query; },in() { return query; },order() { return query; },limit() { return query; },
        range(from: number) { offset = from;return query; },
        insert(payload: unknown) { inserting = true;writes.push({ table,payload });return query; },
        maybeSingle() { return Promise.resolve({ data: null,error: null }); },single() { return Promise.resolve(result()); },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return query;
    } } as unknown as SupabaseClient<Database>;
    await generateExecutiveStandupDraft(client,"org","user",null);
    const header = writes.find((write) => write.table === "exec_standup_snapshots")!.payload as Row;
    expect(header.summary_json).toMatchObject({ source_facility_ids: [a],live_generated_at: when });
    const rows = writes.find((write) => write.table === "exec_standup_snapshot_metrics")!.payload as Row[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.freshness_at === null)).toBe(true);
    for (const row of rows) expect(readStandupSourceQuality({ sourceRefJson: row.source_ref_json })).toMatchObject({ calculated_at: when,source_as_of: null,period_coverage: "unconfirmed" });
  });
});

describe("manual standup receipt and original scope", () => {
  it.each([null, [null], { old_receipt: "preserved" }, "legacy reference", 42].map((raw) => ({ raw })))("preserves arbitrary legacy provenance $raw without failing after the manual write", async ({ raw }) => {
    const fixture = persistenceClient([a,b]);
    for (const row of fixture.rows) row.source_ref_json = raw;
    await saveStandupMetricInput(fixture.client,{ snapshotId: "snapshot",organizationId: "org",weekOf: "2026-09-07",facilityId: a,metricKey: "current_ar_cents",userId: "user",valueNumeric: 0 });
    const saved = fixture.rows.find((row) => row.id === "row-a")!;
    const total = fixture.rows.find((row) => row.id === "row-total")!;
    for (const original of Array.isArray(raw) ? raw : [raw]) {
      expect(saved.source_ref_json).toContainEqual(original);
      expect(total.source_ref_json).toContainEqual(original);
    }
    expect(total.value_numeric).toBe(70);
    expect(readStandupSourceQuality({ sourceRefJson: saved.source_ref_json })?.basis).toBe("manual");
    expect(readStandupSourceQuality({ sourceRefJson: total.source_ref_json })?.basis).toBe("unknown");
  });

  it("retains missing facilities in the saved subtotal denominator", async () => {
    const c = "00000000-0000-4000-8000-000000000003";
    const fixture = persistenceClient([a,b,c]);
    await saveStandupMetricInput(fixture.client,{ snapshotId: "snapshot",organizationId: "org",weekOf: "2026-09-07",facilityId: a,metricKey: "current_ar_cents",userId: "user",valueNumeric: 0 });
    const total = fixture.rows.find((row) => row.id === "row-total")!;
    const row = { sourceRefJson: total.source_ref_json,valueNumeric: total.value_numeric as number };
    expect(total.value_numeric).toBe(70);
    expect(total.confidence_band).toBe("low");
    expect(readStandupSourceQuality(row)?.expected_facility_ids).toEqual([a,b,c]);
    expect(qualifyStandupValue(row,"70")).toBe("70 — partial 2/3");
  });

  it.each([true,false])("preserves original scope availability=%s and separates entry time from source time", async (known) => {
    vi.useFakeTimers({ toFake: ["Date"] });vi.setSystemTime(new Date(when));
    const fixture=persistenceClient(known ? [a,b] : null);
    await saveStandupMetricInput(fixture.client,{ snapshotId: "snapshot",organizationId: "org",weekOf: "2026-09-07",facilityId: a,metricKey: "current_ar_cents",userId: "user",valueNumeric: 0 });
    const saved=fixture.rows.find((row) => row.id === "row-a")!;
    const total=fixture.rows.find((row) => row.id === "row-total")!;
    expect(saved.freshness_at).toBeNull();expect(total.freshness_at).toBeNull();
    expect(readStandupSourceQuality({ sourceRefJson: saved.source_ref_json })).toMatchObject({ received_at: when,source_as_of: null,basis: "manual",expected_facility_ids: known ? [a] : null });
    expect(saved.source_ref_json).toContainEqual({ table: "invoices" });
    expect(total.value_numeric).toBe(70);
    expect(readStandupSourceQuality({ sourceRefJson: total.source_ref_json })).toMatchObject({ expected_facility_ids: known ? [a,b] : null,contributing_facility_ids: [a,b],basis: "mixed",received_at: null });
    expect(fixture.header.summary_json).toEqual(known ? { source_facility_ids: [a,b] } : {});
    expect(fixture.queries.some((query) => query.table === "exec_standup_snapshot_metrics" && query.offset === 3)).toBe(true);
    expect(fixture.queries.some((query) => query.table === "facilities")).toBe(false);
    expect(canCompareStandupMetrics(metric(),{ sourceRefJson: total.source_ref_json,valueNumeric: 70 })).toBe(false);
  });
});
