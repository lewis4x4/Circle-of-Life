import { describe, expect, it } from "vitest";

import {
  censusReasonKeyFromLabel,
  describeOperatingRuleValue,
  draftFromValue,
  facilityOverridesInForce,
  operatingRuleValueFromDraft,
  OPERATING_RULE_COPY,
} from "./operating-rules-settings";

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
    // The latest validator (migration 544, COL-333).
    const sql = readFileSync(`${process.cwd()}/supabase/migrations/544_admission_arrival_approvers_role_list.sql`, "utf8");
    const { OPERATING_RULE_KEYS, CENSUS_NOTICE_ROLE_CHOICES, ARRIVAL_APPROVAL_ROLE_CHOICES } = await import("./operating-rules");
    for (const key of OPERATING_RULE_KEYS) expect(sql).toContain(`'${key}'`);
    expect(sql).toContain(`NOT IN (${CENSUS_NOTICE_ROLE_CHOICES.map((role) => `'${role}'`).join(", ")})`);
    expect(sql).toContain(`NOT IN (${ARRIVAL_APPROVAL_ROLE_CHOICES.map((role) => `'${role}'`).join(", ")})`);
    expect(sql).toContain("NOT BETWEEN 0 AND 60");
    expect(sql).toContain("NOT BETWEEN 0 AND 1440");
    expect(sql).toContain("^[a-z][a-z0-9_]{0,39}$");
    expect(sql).toContain("NOT BETWEEN 0 AND 20");
  });
});

describe("Stand Up census reasons (COL-555, migration 534)", () => {
  const reasons = [
    { key: "roster_not_current", label: "Roster not updated yet" },
    { key: "other", label: "Other" },
  ];

  it("describes the list as its labels", () => {
    expect(describeOperatingRuleValue("stand_up.census_reason_options", reasons)).toBe("Roster not updated yet, Other");
    expect(describeOperatingRuleValue("stand_up.census_reason_options", [])).toBe("Not readable");
  });

  it("derives a key from the label: lowercase, underscores, starts with a letter, at most 40 characters", () => {
    expect(censusReasonKeyFromLabel("Hospital hold not closed", new Set())).toBe("hospital_hold_not_closed");
    expect(censusReasonKeyFromLabel("  3rd-party count (DCF)!  ", new Set())).toBe("rd_party_count_dcf");
    expect(censusReasonKeyFromLabel("123", new Set())).toBe("reason");
    const long = censusReasonKeyFromLabel("A".repeat(60), new Set());
    expect(long).toBe("a".repeat(40));
    expect(long).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
  });

  it("makes a derived key unique with a numeric suffix", () => {
    expect(censusReasonKeyFromLabel("Other", new Set(["other"]))).toBe("other_2");
    expect(censusReasonKeyFromLabel("Other", new Set(["other", "other_2"]))).toBe("other_3");
    const taken = new Set(["a".repeat(40)]);
    const key = censusReasonKeyFromLabel("a".repeat(45), taken);
    expect(key).toBe(`${"a".repeat(38)}_2`);
    expect(key).toMatch(/^[a-z][a-z0-9_]{0,39}$/);
  });

  it("keeps existing keys, keys new rows from their labels and trims labels", () => {
    const draft = draftFromValue("stand_up.census_reason_options", reasons);
    expect(draft).toEqual({ key: "stand_up.census_reason_options", reasons });
    if (draft.key !== "stand_up.census_reason_options") throw new Error("wrong draft");
    const result = operatingRuleValueFromDraft({
      ...draft,
      reasons: [
        { key: "roster_not_current", label: "Roster behind  " },
        { key: "other", label: "Other" },
        { key: null, label: " Other reason " },
        { key: null, label: "Other!" },
      ],
    });
    expect(result).toEqual({
      ok: true,
      value: [
        { key: "roster_not_current", label: "Roster behind" },
        { key: "other", label: "Other" },
        { key: "other_reason", label: "Other reason" },
        { key: "other_2", label: "Other!" },
      ],
    });
  });

  it("refuses an empty list, more than 12, blank labels and repeated labels", () => {
    const fromRows = (rows: Array<{ key: string | null; label: string }>) =>
      operatingRuleValueFromDraft({ key: "stand_up.census_reason_options", reasons: rows });
    expect(fromRows([]).ok).toBe(false);
    expect(fromRows(Array.from({ length: 13 }, (_, i) => ({ key: null, label: `Reason ${i}` }))).ok).toBe(false);
    expect(fromRows(Array.from({ length: 12 }, (_, i) => ({ key: null, label: `Reason ${i}` }))).ok).toBe(true);
    expect(fromRows([{ key: null, label: "   " }]).ok).toBe(false);
    expect(fromRows([{ key: null, label: "x".repeat(81) }]).ok).toBe(false);
    expect(fromRows([{ key: "other", label: "Other" }, { key: null, label: "other" }]).ok).toBe(false);
  });
});

describe("Stand Up census notice delivery", () => {
  it("describes in-app delivery and no notices", () => {
    expect(describeOperatingRuleValue("stand_up.census_notice_channels", ["in_app"])).toBe("In Haven (Home and the Stand Up page)");
    expect(describeOperatingRuleValue("stand_up.census_notice_channels", [])).toBe("No notices");
    expect(describeOperatingRuleValue("stand_up.census_notice_channels", ["push"])).toBe("Not readable");
  });

  it("stores [] for no notices and refuses anything but in_app", () => {
    expect(operatingRuleValueFromDraft({ key: "stand_up.census_notice_channels", channels: [] })).toEqual({ ok: true, value: [] });
    expect(operatingRuleValueFromDraft({ key: "stand_up.census_notice_channels", channels: ["in_app"] })).toEqual({ ok: true, value: ["in_app"] });
    expect(operatingRuleValueFromDraft({ key: "stand_up.census_notice_channels", channels: ["in_app", "push"] }).ok).toBe(false);
    expect(operatingRuleValueFromDraft({ key: "stand_up.census_notice_channels", channels: ["sms"] }).ok).toBe(false);
    expect(operatingRuleValueFromDraft({ key: "stand_up.census_notice_channels", channels: ["email"] }).ok).toBe(false);
  });
});

describe("Thursday switches", () => {
  it("describes on and off in plain words", () => {
    expect(describeOperatingRuleValue("stand_up.thursday_census_vs_monday", true)).toBe("On: Thursday's census and hospital figures are also checked against the census bridge from Monday");
    expect(describeOperatingRuleValue("stand_up.thursday_census_vs_monday", false)).toBe("Off: Thursday is compared with the roster only");
    expect(describeOperatingRuleValue("stand_up.thursday_admission_notes_to_recruiters", true)).toMatch(/^On: recruiters read admission notes/);
    expect(describeOperatingRuleValue("stand_up.thursday_admission_notes_to_recruiters", "yes")).toBe("Not readable");
  });

  it("stores a boolean and needs a choice", () => {
    expect(operatingRuleValueFromDraft({ key: "stand_up.thursday_census_vs_monday", on: true })).toEqual({ ok: true, value: true });
    expect(operatingRuleValueFromDraft({ key: "stand_up.thursday_admission_notes_to_recruiters", on: false })).toEqual({ ok: true, value: false });
    expect(operatingRuleValueFromDraft({ key: "stand_up.thursday_census_vs_monday", on: null }).ok).toBe(false);
    expect(draftFromValue("stand_up.thursday_census_vs_monday", "junk")).toEqual({ key: "stand_up.thursday_census_vs_monday", on: null });
  });
});

describe("Thursday census bridge settings (COL-749, migration 542)", () => {
  it("keeps the tolerance a whole number of residents from 0 to 20", () => {
    expect(describeOperatingRuleValue("stand_up.thursday_bridge_tolerance", 0)).toBe("Must match exactly");
    expect(describeOperatingRuleValue("stand_up.thursday_bridge_tolerance", 1)).toBe("Within 1 resident");
    expect(describeOperatingRuleValue("stand_up.thursday_bridge_tolerance", 21)).toBe("Not readable");
    expect(operatingRuleValueFromDraft({ key: "stand_up.thursday_bridge_tolerance", residents: "2" })).toEqual({ ok: true, value: 2 });
    expect(operatingRuleValueFromDraft({ key: "stand_up.thursday_bridge_tolerance", residents: "21" }).ok).toBe(false);
    expect(operatingRuleValueFromDraft({ key: "stand_up.thursday_bridge_tolerance", residents: "1.5" }).ok).toBe(false);
    expect(draftFromValue("stand_up.thursday_bridge_tolerance", 0)).toEqual({ key: "stand_up.thursday_bridge_tolerance", residents: "0" });
  });

  it("words the hospital-in-census and recruiter workflow switches", () => {
    expect(describeOperatingRuleValue("stand_up.census_bridge_hospital_in_census", true)).toBe("On: hospital and rehab stays stay in census");
    expect(describeOperatingRuleValue("stand_up.thursday_admission_workflow_to_recruiters", false)).toBe("Off: admission steps are hidden from recruiters");
    expect(operatingRuleValueFromDraft({ key: "stand_up.census_bridge_hospital_in_census", on: false })).toEqual({ ok: true, value: false });
    expect(OPERATING_RULE_COPY["stand_up.thursday_admission_workflow_to_recruiters"].description).toMatch(/Nothing clinical is ever included/);
  });
});

describe("Who approves an arrival (COL-333)", () => {
  it("names the roles, with facility_admin as Administrator", () => {
    expect(describeOperatingRuleValue("admissions.arrival_approval_roles", ["owner", "facility_admin"])).toBe("Owner, Administrator");
    expect(describeOperatingRuleValue("admissions.arrival_approval_roles", [])).toBe("Not readable");
    expect(describeOperatingRuleValue("admissions.arrival_approval_roles", ["recruiter"])).toBe("Not readable");
    expect(describeOperatingRuleValue("admissions.arrival_approval_roles", ["owner", "owner"])).toBe("Not readable");
  });

  it("can be widened to the Assistant Administrator (Brian, 2026-09-25)", () => {
    expect(describeOperatingRuleValue("admissions.arrival_approval_roles", ["owner", "org_admin", "facility_admin", "admin_assistant"])).toBe(
      "Owner, Org admin, Administrator, Assistant administrator",
    );
    expect(operatingRuleValueFromDraft({ key: "admissions.arrival_approval_roles", roles: ["admin_assistant", "manager"] })).toEqual({
      ok: true,
      value: ["admin_assistant", "manager"],
    });
  });

  it("needs at least one role and keeps the database order", () => {
    expect(operatingRuleValueFromDraft({ key: "admissions.arrival_approval_roles", roles: [] }).ok).toBe(false);
    expect(operatingRuleValueFromDraft({ key: "admissions.arrival_approval_roles", roles: ["facility_admin", "owner"] })).toEqual({
      ok: true,
      value: ["owner", "facility_admin"],
    });
  });
});

describe("facilityOverridesInForce", () => {
  const row = (id: string, facilityId: string | null, effectiveFrom: string, value: unknown, createdAt = "2026-09-01T00:00:00Z") => ({
    id,
    ruleKey: "stand_up.thursday_census_vs_monday" as const,
    facilityId,
    value,
    effectiveFrom,
    changeReason: "why",
    createdAt,
  });

  it("takes each facility's latest row on or before today, skipping organization and future rows", () => {
    const out = facilityOverridesInForce(
      [
        row("1", null, "2026-09-20", false),
        row("2", "f-b", "2026-09-10", true),
        row("3", "f-b", "2026-09-20", false),
        row("4", "f-a", "2026-09-30", true),
        row("5", "f-a", "2026-09-01", true),
      ],
      [
        { id: "f-a", name: "Alpha" },
        { id: "f-b", name: "Beta" },
      ],
      "2026-09-25",
    );
    expect(out).toEqual([
      { facilityId: "f-a", facilityName: "Alpha", value: true, effectiveFrom: "2026-09-01" },
      { facilityId: "f-b", facilityName: "Beta", value: false, effectiveFrom: "2026-09-20" },
    ]);
  });
});
