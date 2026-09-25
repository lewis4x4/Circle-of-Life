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
    expect(describeOperatingRuleValue("resident_movement.backdate_window_days", 3)).toBe("Up to 3 days back");
    expect(describeOperatingRuleValue("resident_movement.backdate_window_days", 1)).toBe("Up to 1 day back");
    expect(describeOperatingRuleValue("resident_movement.backdate_window_days", 0)).toBe("Owner or org admin only");
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

describe("resident movement back-date window (COL-750)", () => {
  it("allows 0 (owner only) up to 365 whole days", () => {
    expect(operatingRuleValueFromDraft({ key: "resident_movement.backdate_window_days", days: "0" })).toEqual({ ok: true, value: 0 });
    expect(operatingRuleValueFromDraft({ key: "resident_movement.backdate_window_days", days: "7" })).toEqual({ ok: true, value: 7 });
    expect(operatingRuleValueFromDraft({ key: "resident_movement.backdate_window_days", days: "366" }).ok).toBe(false);
    expect(operatingRuleValueFromDraft({ key: "resident_movement.backdate_window_days", days: "-1" }).ok).toBe(false);
    expect(operatingRuleValueFromDraft({ key: "resident_movement.backdate_window_days", days: "" }).ok).toBe(false);
  });
});

describe("Stand Up census settings (COL-555 / COL-751)", () => {
  it("describes and validates the reason window, the notice lead time and who is told", async () => {
    const { describeOperatingRuleValue: describe_, operatingRuleValueFromDraft: fromDraft } = await import("./operating-rules-settings");
    expect(describe_("stand_up.census_reason_window_days", 7)).toBe("7 days");
    expect(describe_("stand_up.census_reason_window_days", 0)).toBe("A reason never holds");
    expect(describe_("stand_up.census_notice_lead_minutes", 60)).toBe("60 minutes before the deadline, and at it");
    expect(describe_("stand_up.census_notice_lead_minutes", 0)).toBe("At the deadline only");
    expect(describe_("stand_up.census_notice_roles", ["facility_admin", "manager"])).toBe("Administrator, Manager");
    expect(describe_("stand_up.census_notice_roles", ["med_tech"])).toBe("Not readable");
    expect(fromDraft({ key: "stand_up.census_reason_window_days", days: "61" }).ok).toBe(false);
    expect(fromDraft({ key: "stand_up.census_notice_lead_minutes", minutes: "90" })).toEqual({ ok: true, value: 90 });
    expect(fromDraft({ key: "stand_up.census_notice_roles", roles: [] }).ok).toBe(false);
    expect(fromDraft({ key: "stand_up.census_notice_roles", roles: ["manager", "facility_admin"] })).toEqual({ ok: true, value: ["facility_admin", "manager"] });
  });

  it("holds the same keys and bounds as the database", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(`${process.cwd()}/supabase/migrations/523_census_disagreement_notice.sql`, "utf8");
    const { OPERATING_RULE_KEYS, CENSUS_NOTICE_ROLE_CHOICES } = await import("./operating-rules");
    for (const key of OPERATING_RULE_KEYS) expect(sql).toContain(`'${key}'`);
    expect(sql).toContain(`NOT IN (${CENSUS_NOTICE_ROLE_CHOICES.map((role) => `'${role}'`).join(", ")})`);
    expect(sql).toContain("NOT BETWEEN 0 AND 60");
    expect(sql).toContain("NOT BETWEEN 0 AND 1440");
  });
});
