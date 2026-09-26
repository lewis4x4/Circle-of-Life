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
function fakeClient(tables: Record<string, { data: unknown; error?: { code?: string; message?: string } | null }>) {
  const calls: Record<string, string[]> = {};
  const builder = (table: string) => {
    const result = tables[table] ?? { data: [], error: null };
    const record = (name: string) => (calls[table] ??= []).push(name);
    const q = {
      select: () => (record("select"), q),
      order: () => q,
      gte: (_c: string, v: string) => (record(`gte:${v}`), q),
      in: () => q,
      eq: () => q,
      limit: () => q,
      range: (from: number, to: number) => (record(`range:${from}-${to}`), Promise.resolve({ data: result.data, error: result.error ?? null })),
      maybeSingle: () => Promise.resolve({ data: result.data, error: result.error ?? null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: result.data, error: result.error ?? null }),
    };
    return q;
  };
  return { sb: { from: builder } as unknown as SupabaseClient, calls };
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

  it("reports a permission error as forbidden", async () => {
    const { sb } = fakeClient({ document_intake_jev_outcomes: { data: null, error: { code: "42501", message: "permission denied" } } });
    await expect(loadAccuracyReport(sb, "all", Date.now())).rejects.toMatchObject({ forbidden: true });
  });
});
