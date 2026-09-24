import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  loadOperatingRule,
  loadRiskScoreBands,
  loadSurveyBinderDueWindowDays,
  parseDueWindowDays,
  parseScoreAlertBelowPct,
} from "./operating-rules";
import { parseRiskScoreBands, riskAlertThresholdJson, riskLevelFromBands } from "./risk-bands";

function rpcReturning(result: { data: unknown; error: unknown }, calls: unknown[] = []) {
  return {
    rpc: (name: string, args: unknown) => {
      calls.push({ name, args });
      return Promise.resolve(result);
    },
  } as unknown as SupabaseClient;
}

describe("risk bands", () => {
  const bands = { critical_below: 50, high_below: 70, moderate_below: 85 };

  it("levels a score by the bands", () => {
    expect(riskLevelFromBands(49, bands)).toBe("critical");
    expect(riskLevelFromBands(50, bands)).toBe("high");
    expect(riskLevelFromBands(69, bands)).toBe("high");
    expect(riskLevelFromBands(70, bands)).toBe("moderate");
    expect(riskLevelFromBands(85, bands)).toBe("low");
  });

  it("derives the alert threshold from the bands", () => {
    expect(riskAlertThresholdJson(bands)).toEqual({ alert_level: "high", score_lte: 69, critical_score_lte: 49 });
    expect(riskAlertThresholdJson({ critical_below: 40, high_below: 60, moderate_below: 80 })).toEqual({
      alert_level: "high",
      score_lte: 59,
      critical_score_lte: 39,
    });
  });

  it("refuses bands that do not rise or are out of range", () => {
    expect(parseRiskScoreBands(bands)).toEqual(bands);
    expect(parseRiskScoreBands({ critical_below: 70, high_below: 50, moderate_below: 85 })).toBeNull();
    expect(parseRiskScoreBands({ critical_below: 0, high_below: 50, moderate_below: 85 })).toBeNull();
    expect(parseRiskScoreBands({ critical_below: 50, high_below: 70, moderate_below: 101 })).toBeNull();
    expect(parseRiskScoreBands({ critical_below: 50.5, high_below: 70, moderate_below: 85 })).toBeNull();
    expect(parseRiskScoreBands(null)).toBeNull();
  });
});

describe("rule value parsers", () => {
  it("accepts whole-day windows from 1 to 365", () => {
    expect(parseDueWindowDays(60)).toBe(60);
    expect(parseDueWindowDays(0)).toBeNull();
    expect(parseDueWindowDays(366)).toBeNull();
    expect(parseDueWindowDays("60")).toBeNull();
  });

  it("treats JSON null as the alert switched off, and junk as unreadable", () => {
    expect(parseScoreAlertBelowPct(null)).toEqual({ off: true });
    expect(parseScoreAlertBelowPct(80)).toEqual({ off: false, belowPct: 80 });
    expect(parseScoreAlertBelowPct(0)).toBeNull();
    expect(parseScoreAlertBelowPct("80")).toBeNull();
  });
});

describe("loadOperatingRule", () => {
  it("calls the resolver with the scope and key", async () => {
    const calls: unknown[] = [];
    const supabase = rpcReturning(
      { data: [{ value: 45, rule_id: "r1", effective_from: "2026-10-01", facility_id: null }], error: null },
      calls,
    );
    const days = await loadSurveyBinderDueWindowDays(supabase, { facilityId: "f1", asOf: "2026-10-02" });
    expect(days).toBe(45);
    expect(calls).toEqual([
      {
        name: "haven_operating_rule",
        args: { p_organization_id: null, p_facility_id: "f1", p_rule_key: "survey_binder.due_window_days", p_as_of: "2026-10-02" },
      },
    ]);
  });

  it("returns null when the read fails, never a guessed default", async () => {
    const supabase = rpcReturning({ data: null, error: { message: "boom" } });
    expect(await loadOperatingRule(supabase, { key: "risk.score_bands" })).toBeNull();
    expect(await loadRiskScoreBands(supabase, {})).toBeNull();
    expect(await loadSurveyBinderDueWindowDays(supabase, {})).toBeNull();
  });
});
