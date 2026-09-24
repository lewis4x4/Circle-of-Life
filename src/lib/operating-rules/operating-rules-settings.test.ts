import { describe, expect, it } from "vitest";

import { describeOperatingRuleValue, operatingRuleValueFromDraft } from "./operating-rules-settings";

describe("describeOperatingRuleValue", () => {
  it("names each rule's value", () => {
    expect(describeOperatingRuleValue("risk.score_bands", { critical_below: 50, high_below: 70, moderate_below: 85 })).toBe(
      "Critical below 50 · high below 70 · moderate below 85",
    );
    expect(describeOperatingRuleValue("survey_binder.due_window_days", 45)).toBe("45 days");
    expect(describeOperatingRuleValue("compliance.score_alert_below_pct", null)).toBe("Off");
    expect(describeOperatingRuleValue("compliance.score_alert_below_pct", 80)).toBe("Alert below 80%");
  });

  it("says a value could not be read instead of inventing one", () => {
    expect(describeOperatingRuleValue("compliance.score_alert_below_pct", undefined)).toBe("Not readable");
    expect(describeOperatingRuleValue("survey_binder.due_window_days", undefined)).toBe("Not readable");
  });
});

describe("operatingRuleValueFromDraft", () => {
  it("accepts rising bands and refuses the rest", () => {
    expect(operatingRuleValueFromDraft({ key: "risk.score_bands", critical: "40", high: "60", moderate: "80" })).toEqual({
      ok: true,
      value: { critical_below: 40, high_below: 60, moderate_below: 80 },
    });
    expect(operatingRuleValueFromDraft({ key: "risk.score_bands", critical: "60", high: "60", moderate: "80" }).ok).toBe(false);
    expect(operatingRuleValueFromDraft({ key: "risk.score_bands", critical: "", high: "60", moderate: "80" }).ok).toBe(false);
  });

  it("bounds the binder window", () => {
    expect(operatingRuleValueFromDraft({ key: "survey_binder.due_window_days", days: "90" })).toEqual({ ok: true, value: 90 });
    expect(operatingRuleValueFromDraft({ key: "survey_binder.due_window_days", days: "0" }).ok).toBe(false);
    expect(operatingRuleValueFromDraft({ key: "survey_binder.due_window_days", days: "4.5" }).ok).toBe(false);
  });

  it("stores the alert as JSON null when switched off", () => {
    expect(operatingRuleValueFromDraft({ key: "compliance.score_alert_below_pct", off: true, belowPct: "" })).toEqual({
      ok: true,
      value: null,
    });
    expect(operatingRuleValueFromDraft({ key: "compliance.score_alert_below_pct", off: false, belowPct: "75" })).toEqual({
      ok: true,
      value: 75,
    });
    expect(operatingRuleValueFromDraft({ key: "compliance.score_alert_below_pct", off: false, belowPct: "" }).ok).toBe(false);
  });
});
