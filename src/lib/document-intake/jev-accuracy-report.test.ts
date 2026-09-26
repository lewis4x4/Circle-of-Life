import { describe, expect, it } from "vitest";

import {
  buildAccuracyReport,
  formatMargin,
  formatShare,
  marginFromRouting,
  marginSettingSql,
  parseAccuracyWindow,
  recommendationLabel,
  windowStartIso,
  type JevCheckViewRow,
  type JevOutcomeViewRow,
} from "./jev-accuracy-report";

let seq = 0;
function outcome(over: Partial<JevOutcomeViewRow> = {}): JevOutcomeViewRow {
  seq += 1;
  return {
    filing_id: `f${seq}`,
    item_id: `i${seq}`,
    approved_at: `2026-09-${String(10 + (seq % 15)).padStart(2, "0")}T12:00:00Z`,
    proposed_code: "vendor_coi",
    filed_code: "vendor_coi",
    type_correct: true,
    jev_state: "ran",
    questions_version: "intake-v2/vendor_coi.1",
    jev_choice: "c0",
    jev_margin: 0.5,
    margin_at_run: 0.2,
    jev_top_correct: true,
    ...over,
  };
}

function check(over: Partial<JevCheckViewRow> = {}): JevCheckViewRow {
  return {
    filing_id: "f1",
    item_id: "i1",
    approved_at: "2026-09-20T12:00:00Z",
    filed_code: "vendor_coi",
    questions_version: "intake-v2/vendor_coi.1",
    check_code: "jev_holder_matches",
    check_label: "Certificate holder is this facility",
    jev_result: "fail",
    verdict: "right",
    ...over,
  };
}

const labels = { vendor_coi: "Vendor certificate of insurance", facility_license: "Facility license" };

describe("buildAccuracyReport", () => {
  it("returns empty tiers for an empty window", () => {
    const report = buildAccuracyReport({ outcomes: [], checks: [], catalogLabels: labels, documentIntakeRouting: null });
    expect(report).toEqual({ readerAgreement: { agree: 0, total: 0 }, types: [], details: {}, misses: [] });
  });

  it("builds Tier 1 per filed type with k of n, lower bound, margin now and recommendation", () => {
    const outcomes = [
      ...Array.from({ length: 30 }, () => outcome()),
      outcome({ jev_state: "not_authorized", questions_version: null, jev_choice: null, jev_margin: null, jev_top_correct: null }),
      outcome({ filed_code: "facility_license", proposed_code: "vendor_coi", type_correct: false, jev_state: "skipped", questions_version: null, jev_top_correct: null }),
    ];
    const report = buildAccuracyReport({ outcomes, checks: [], catalogLabels: labels, documentIntakeRouting: { jev_margin: 0.3 } });
    expect(report.readerAgreement).toEqual({ agree: 31, total: 32 });
    // facility_license has no Jev activity in the window, so it has no row.
    expect(report.types.map((t) => t.code)).toEqual(["vendor_coi"]);
    const coi = report.types[0];
    expect(coi).toMatchObject({ label: "Vendor certificate of insurance", filed: 31, jevRan: 30, right: 30, evaluated: 30, excludedOlder: 0 });
    expect(coi.lowerBound?.toFixed(4)).toBe("0.8865");
    expect(coi.marginNow).toEqual({ value: 0.3, source: "policy" });
    expect(recommendationLabel(coi.recommendation)).toBe("Keep");
  });

  it("uses only the current questions_version and counts the older documents it left out", () => {
    const outcomes = [
      outcome({ questions_version: "intake-v2/vendor_coi.1", approved_at: "2026-09-01T00:00:00Z", jev_top_correct: false }),
      outcome({ questions_version: "intake-v2/vendor_coi.1", approved_at: "2026-09-02T00:00:00Z", jev_top_correct: false }),
      outcome({ questions_version: "intake-v2/vendor_coi.2", approved_at: "2026-09-20T00:00:00Z" }),
    ];
    const checks = [
      check({ filing_id: outcomes[0].filing_id, questions_version: "intake-v2/vendor_coi.1", verdict: "wrong" }),
      check({ filing_id: outcomes[2].filing_id, questions_version: "intake-v2/vendor_coi.2", verdict: "right" }),
    ];
    const report = buildAccuracyReport({ outcomes, checks, catalogLabels: labels, documentIntakeRouting: null });
    const coi = report.types[0];
    expect(coi.questionsVersion).toBe("intake-v2/vendor_coi.2");
    expect(coi).toMatchObject({ jevRan: 1, right: 1, evaluated: 1, excludedOlder: 2 });
    expect(recommendationLabel(coi.recommendation)).toBe("Collect 1 of 30");
    const detail = report.details.vendor_coi;
    expect(detail.checks).toHaveLength(1);
    expect(detail.checks[0]).toMatchObject({ code: "jev_holder_matches", answered: 1, rated: 1, right_rate: 1, action: "collect" });
  });

  it("falls back to the latest run's margin when the live setting cannot be read", () => {
    const outcomes = [
      outcome({ approved_at: "2026-09-01T00:00:00Z", margin_at_run: 0.15 }),
      outcome({ approved_at: "2026-09-05T00:00:00Z", margin_at_run: 0.4 }),
    ];
    const report = buildAccuracyReport({ outcomes, checks: [], catalogLabels: labels, documentIntakeRouting: null });
    expect(report.types[0].marginNow).toEqual({ value: 0.4, source: "last_run" });
  });

  it("builds the Tier 2 margin table and setting text for a tighten", () => {
    const outcomes = [
      ...Array.from({ length: 3 }, () => outcome({ jev_margin: 0.25, jev_top_correct: false })),
      ...Array.from({ length: 7 }, () => outcome({ jev_margin: 0.25 })),
      ...Array.from({ length: 25 }, () => outcome({ jev_margin: 0.5 })),
    ];
    const report = buildAccuracyReport({ outcomes, checks: [], catalogLabels: labels, documentIntakeRouting: {} });
    expect(recommendationLabel(report.types[0].recommendation)).toBe("Tighten to 0.3");
    const detail = report.details.vendor_coi;
    const at02 = detail.margins.find((m) => m.margin === 0.2);
    expect(at02).toMatchObject({ cleared: 35, right: 32, current: true });
    const at03 = detail.margins.find((m) => m.margin === 0.3);
    expect(at03).toMatchObject({ cleared: 25, right: 25, accuracy: 1, current: false });
    expect(detail.margins.find((m) => m.margin === 0.6)).toMatchObject({ cleared: 0, accuracy: null, lowerBound: null });
    expect(detail.sql).toContain("jsonb_build_object('vendor_coi', 0.3)");
  });

  it("offers no setting text when the recommendation is to keep or collect", () => {
    const report = buildAccuracyReport({ outcomes: [outcome()], checks: [], catalogLabels: labels, documentIntakeRouting: null });
    expect(report.details.vendor_coi.sql).toBeNull();
  });

  it("lists misses newest first: wrong top picks and Wrong check verdicts, never twice", () => {
    const wrongPick = outcome({ approved_at: "2026-09-03T00:00:00Z", jev_top_correct: false, jev_choice: "c1" });
    const wrongBoth = outcome({ approved_at: "2026-09-09T00:00:00Z", jev_top_correct: false, jev_choice: "none" });
    const wrongCheck = outcome({ approved_at: "2026-09-06T00:00:00Z" });
    const clean = outcome({ approved_at: "2026-09-07T00:00:00Z" });
    const checks = [
      check({ filing_id: wrongBoth.filing_id, item_id: wrongBoth.item_id, verdict: "wrong" }),
      check({ filing_id: wrongCheck.filing_id, item_id: wrongCheck.item_id, verdict: "wrong", check_label: "Workers comp line is present" }),
      check({ filing_id: clean.filing_id, item_id: clean.item_id, verdict: "cant_tell" }),
    ];
    const report = buildAccuracyReport({
      outcomes: [wrongPick, wrongBoth, wrongCheck, clean],
      checks,
      catalogLabels: labels,
      documentIntakeRouting: null,
      destinationKinds: { [wrongBoth.filing_id]: "facility_document" },
    });
    expect(report.misses.map((m) => m.filingId)).toEqual([wrongBoth.filing_id, wrongCheck.filing_id, wrongPick.filing_id]);
    expect(report.misses[0]).toMatchObject({ itemId: wrongBoth.item_id, jevChoice: "none", reasons: ["top_pick", "check"], label: "Vendor certificate of insurance", destinationKind: "facility_document" });
    expect(report.misses[1]).toMatchObject({ reasons: ["check"], wrongChecks: ["Workers comp line is present"] });
    expect(report.misses[2]).toMatchObject({ reasons: ["top_pick"], jevChoice: "c1", wrongChecks: [], destinationKind: null });
  });
});

describe("marginFromRouting", () => {
  it("prefers the per-type margin, then the global margin, then 0.2", () => {
    expect(marginFromRouting({ jev_margin_by_type: { vendor_coi: 0.1 }, jev_margin: 0.3 }, "vendor_coi")).toBe(0.1);
    expect(marginFromRouting({ jev_margin_by_type: { other: 0.1 }, jev_margin: 0.3 }, "vendor_coi")).toBe(0.3);
    expect(marginFromRouting({}, "vendor_coi")).toBe(0.2);
    expect(marginFromRouting(null, "vendor_coi")).toBe(0.2);
  });

  it("ignores values outside [0, 1]", () => {
    expect(marginFromRouting({ jev_margin_by_type: { vendor_coi: 1.5 }, jev_margin: -1 }, "vendor_coi")).toBe(0.2);
    expect(marginFromRouting({ jev_margin_by_type: { vendor_coi: "0.1" }, jev_margin: 0.4 }, "vendor_coi")).toBe(0.4);
  });
});

describe("marginSettingSql", () => {
  it("renders the spec statement with the code and value filled in", () => {
    expect(marginSettingSql("vendor_coi", 0.1)).toBe(
      [
        "update public.ai_invocation_policies",
        "set routing_json = jsonb_set(",
        "  routing_json, '{document_intake,jev_margin_by_type}',",
        "  coalesce(routing_json->'document_intake'->'jev_margin_by_type', '{}'::jsonb) || jsonb_build_object('vendor_coi', 0.1),",
        "  true)",
        "where organization_id = '00000000-0000-0000-0000-000000000001';",
      ].join("\n"),
    );
  });

  it("formats values without trailing zeros", () => {
    expect(marginSettingSql("form_1823", 1)).toContain("jsonb_build_object('form_1823', 1)");
    expect(formatMargin(0.15)).toBe("0.15");
    expect(formatMargin(0.1 + 0.2)).toBe("0.3");
  });

  it("refuses anything that is not a catalog code or a margin", () => {
    expect(() => marginSettingSql("vendor_coi'); drop table x; --", 0.1)).toThrow();
    expect(() => marginSettingSql("Vendor", 0.1)).toThrow();
    expect(() => marginSettingSql("v", 0.1)).toThrow();
    expect(() => marginSettingSql("vendor_coi", 1.2)).toThrow();
    expect(() => marginSettingSql("vendor_coi", Number.NaN)).toThrow();
  });
});

describe("window and formatting helpers", () => {
  it("parses the window with a 30 day default", () => {
    expect(parseAccuracyWindow("14")).toBe("14");
    expect(parseAccuracyWindow("all")).toBe("all");
    expect(parseAccuracyWindow("7")).toBe("30");
    expect(parseAccuracyWindow(undefined)).toBe("30");
  });

  it("computes the window start", () => {
    const now = Date.parse("2026-09-25T00:00:00Z");
    expect(windowStartIso("14", now)).toBe("2026-09-11T00:00:00.000Z");
    expect(windowStartIso("all", now)).toBeNull();
  });

  it("rounds shares down", () => {
    expect(formatShare(0.8865)).toBe("88.6%");
    expect(formatShare(1)).toBe("100%");
    expect(formatShare(null)).toBe("Not enough yet");
  });
});
