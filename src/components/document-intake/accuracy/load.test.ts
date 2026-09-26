import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import { loadAccuracyReport, parseCheckRow, parseOutcomeRow } from "./load";

const OUTCOME = {
  filing_id: "f1",
  item_id: "i1",
  approved_at: "2026-09-20T12:00:00Z",
  proposed_code: "vendor_coi",
  filed_code: "vendor_coi",
  type_correct: true,
  jev_state: "ran",
  questions_version: "intake-v2/vendor_coi.1",
  jev_choice: "c0",
  jev_margin: "0.25",
  margin_at_run: 0.2,
  jev_top_correct: false,
};

/** A PostgREST stand-in: records the calls each view and table receives. */
type TableResult = { data: unknown; error?: { code?: string; message?: string } | null };

function fakeClient(tables: Record<string, TableResult | ((inIds: string[]) => TableResult)>) {
  const calls: Record<string, string[]> = {};
  const inCalls: Record<string, string[][]> = {};
  const builder = (table: string) => {
    let inIds: string[] = [];
    const resolveResult = (): TableResult => {
      const entry = tables[table];
      if (typeof entry === "function") return entry(inIds);
      return entry ?? { data: [], error: null };
    };
    const record = (name: string) => (calls[table] ??= []).push(name);
    const done = () => {
      const result = resolveResult();
      return { data: result.data, error: result.error ?? null };
    };
    const q = {
      select: () => (record("select"), q),
      order: (column: string, opts?: { ascending?: boolean }) => (record(`order:${column}:${opts?.ascending === false ? "desc" : "asc"}`), q),
      gte: (_c: string, v: string) => (record(`gte:${v}`), q),
      in: (_c: string, ids: string[]) => ((inIds = ids), (inCalls[table] ??= []).push(ids), q),
      eq: () => q,
      limit: () => q,
      range: (from: number, to: number) => (record(`range:${from}-${to}`), Promise.resolve(done())),
      maybeSingle: () => Promise.resolve(done()),
      then: (resolve: (v: unknown) => unknown) => resolve(done()),
    };
    return q;
  };
  return { sb: { from: builder } as unknown as SupabaseClient, calls, inCalls };
}

describe("parse", () => {
  it("coerces numeric strings and drops rows without ids", () => {
    expect(parseOutcomeRow(OUTCOME)).toMatchObject({ jev_margin: 0.25, margin_at_run: 0.2, jev_top_correct: false });
    expect(parseOutcomeRow({ ...OUTCOME, filing_id: null })).toBeNull();
    expect(parseCheckRow({ filing_id: "f1", item_id: "i1", approved_at: "x", filed_code: "vendor_coi" })).toBeNull();
  });
});

describe("loadAccuracyReport", () => {
  it("reads both views in the window and falls back to the last run's margin when the policy is hidden", async () => {
    const { sb, calls } = fakeClient({
      document_intake_jev_outcomes: { data: [OUTCOME] },
      document_intake_jev_check_outcomes: { data: [] },
      document_intake_catalog: { data: [] },
      ai_invocation_policies: { data: null },
      document_intake_filings: { data: [{ id: "f1", destination_kind: "facility_document" }] },
    });
    const now = Date.parse("2026-09-25T00:00:00Z");
    const report = await loadAccuracyReport(sb, "14", now);
    expect(calls.document_intake_jev_outcomes).toContain("gte:2026-09-11T00:00:00.000Z");
    expect(calls.document_intake_jev_outcomes).toContain("range:0-999");
    expect(report.types[0].marginNow).toEqual({ value: 0.2, source: "last_run" });
    expect(report.misses[0]).toMatchObject({ filingId: "f1", destinationKind: "facility_document" });
  });

  it("pages both views over a total order: the check view also breaks ties on check_code", async () => {
    const { sb, calls } = fakeClient({});
    await loadAccuracyReport(sb, "all", Date.now());
    const orders = (table: string) => (calls[table] ?? []).filter((c) => c.startsWith("order:"));
    expect(orders("document_intake_jev_outcomes")).toEqual(["order:approved_at:desc", "order:filing_id:asc"]);
    expect(orders("document_intake_jev_check_outcomes")).toEqual(["order:approved_at:desc", "order:filing_id:asc", "order:check_code:asc"]);
  });

  it("reads the destination kind of every miss in chunks of 200", async () => {
    const outcomes = Array.from({ length: 450 }, (_, i) => ({ ...OUTCOME, filing_id: `f${i}`, item_id: `i${i}` }));
    const { sb, inCalls } = fakeClient({
      document_intake_jev_outcomes: { data: outcomes },
      document_intake_filings: (ids) => ({ data: ids.map((id) => ({ id, destination_kind: "facility_document" })) }),
    });
    const report = await loadAccuracyReport(sb, "all", Date.now());
    expect(report.misses).toHaveLength(450);
    expect(inCalls.document_intake_filings.map((ids) => ids.length)).toEqual([200, 200, 50]);
    expect(report.misses.every((m) => m.destinationKind === "facility_document")).toBe(true);
  });

  it("reports a permission error as forbidden", async () => {
    const { sb } = fakeClient({ document_intake_jev_outcomes: { data: null, error: { code: "42501", message: "permission denied" } } });
    await expect(loadAccuracyReport(sb, "all", Date.now())).rejects.toMatchObject({ forbidden: true });
  });
});
