import { describe, expect, it } from "vitest";
import type { BenefitsCase, BenefitsRuleEntry } from "@/lib/benefits/contracts";
import { caseFlags, daysUntil, renewalWarningDays } from "./BenefitsQueue";
import { checklistText, describeRule, parseChecklist, parseValidDays, validDaysText } from "./BenefitsRules";
import { screeningStandardFromRules } from "./BenefitsCaseWorkspace";

const base: BenefitsCase = {
  id: "c", organization_id: "o", facility_id: "f", resident_id: "r", admission_case_id: null, program: "smmc_ltc", status: "open", revision: 3,
  next_action: "Collect statements", assigned_to: null, due_date: null, closure_reason: null, screening: {}, funding: {}, created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z", created_by: "u", resident_name: "R", facility_name: "F", assignee_name: null,
};
const today = "2026-09-22";

describe("queue flags", () => {
  it("counts calendar days from the facility's today", () => {
    expect(daysUntil("2026-09-25", today)).toBe(3);
    expect(daysUntil("2026-09-20", today)).toBe(-2);
    expect(daysUntil(null, today)).toBeNull();
    expect(daysUntil("not a date", today)).toBeNull();
  });
  it("flags overdue, due soon, renewal within the configured window, moved and departed residents", () => {
    expect(caseFlags({ ...base, due_date: "2026-09-19" }, today, 60).map((f) => f.key)).toEqual(["overdue"]);
    expect(caseFlags({ ...base, due_date: "2026-09-22" }, today, 60)[0].label).toBe("Due today");
    expect(caseFlags({ ...base, renewal_date: "2026-11-01" }, today, 60).map((f) => f.key)).toEqual(["renewal"]);
    expect(caseFlags({ ...base, renewal_date: "2026-11-01" }, today, 30)).toEqual([]);
    expect(caseFlags({ ...base, renewal_date: "2026-11-01" }, today, null)).toEqual([]);
    expect(caseFlags({ ...base, needs_rebind: true, resident_facility_name: "Oakridge" }, today, 60)[0].label).toContain("Oakridge");
    expect(caseFlags({ ...base, resident_status: "discharged" }, today, 60)[0].label).toBe("Resident discharged");
    expect(caseFlags({ ...base, resident_status: "hospital_hold" }, today, 60)).toEqual([]);
  });
  it("does not flag closed cases as overdue", () => {
    expect(caseFlags({ ...base, status: "closed", due_date: "2026-01-01", renewal_date: "2026-01-01" }, today, 60)).toEqual([]);
  });
  it("reads the renewal window only from a numeric rule", () => {
    expect(renewalWarningDays({ can_manage: false, as_of: today, rules: [{ rule_key: "renewal.warning_days", current: null, value: 45, scheduled: [], history_count: 0 }] })).toBe(45);
    expect(renewalWarningDays({ can_manage: false, as_of: today, rules: [{ rule_key: "renewal.warning_days", current: null, value: "45", scheduled: [], history_count: 0 }] })).toBeNull();
    expect(renewalWarningDays(null)).toBeNull();
  });
});

describe("operating rules editor", () => {
  it("round-trips a checklist through the line format and rejects bad stages", () => {
    const items = parseChecklist("Signed ACCESS application | application | pending\nIncome verification | application");
    expect(items).toEqual([
      { title: "Signed ACCESS application", stage: "application", signature_status: "pending" },
      { title: "Income verification", stage: "application", signature_status: "not_required" },
    ]);
    expect(checklistText(items).split("\n")).toHaveLength(2);
    expect(() => parseChecklist("Something | nowhere")).toThrow(/needs a stage/);
    expect(() => parseChecklist("| application")).toThrow(/title/);
    expect(() => parseChecklist("X | application | maybe")).toThrow(/signature/);
  });
  it("describes each rule kind for the summary line", () => {
    const entry = (rule_key: BenefitsRuleEntry["rule_key"], value: unknown): BenefitsRuleEntry => ({ rule_key, current: null, value, scheduled: [], history_count: 0 });
    expect(describeRule(entry("checklist.oss", [{ title: "a" }]))).toBe("1 requirement");
    expect(describeRule(entry("screening.standard_individual", { income_cents: 298200, assets_cents: 200000, label: "DCF 2026" }))).toBe("Income $2982.00 · Assets $2000.00 · DCF 2026");
    expect(describeRule(entry("screening.standard_individual", null))).toBe("Not recorded");
    expect(describeRule(entry("renewal.warning_days", 60))).toBe("60 days");
    expect(describeRule(entry("screening.recheck_days", 90))).toBe("90 days");
    expect(describeRule(entry("screening.admission_gate", { disqualify: ["q_property_non_primary", "q_income_over_limit", "q_assets"], income_limit_cents: 282900, assets_limit_cents: 200000 })))
      .toBe("Stops on: Property other than home, Income over the limit, Assets over the limit · Income limit $2829.00 · Asset limit $2000.00");
  });
  it("derives the screening standard from the rules payload and tolerates absence", () => {
    const standard = screeningStandardFromRules({ can_manage: true, as_of: today, rules: [{ rule_key: "screening.standard_individual", value: { income_cents: 1, assets_cents: 2, label: "L", source: "https://x" }, current: { id: "i", organization_id: "o", rule_key: "screening.standard_individual", value: {}, effective_from: "2026-01-01", reason: "r", created_by: null, created_at: "t" }, scheduled: [], history_count: 1 }] });
    expect(standard).toEqual({ income_cents: 1, assets_cents: 2, label: "L", source: "https://x", effective_from: "2026-01-01" });
    expect(screeningStandardFromRules({ can_manage: true, as_of: today, rules: [{ rule_key: "screening.standard_individual", value: null, current: null, scheduled: [], history_count: 0 }] })).toBeNull();
    expect(screeningStandardFromRules(null)).toBeNull();
  });
});

describe("document good-for periods (COL-768)", () => {
  it("round-trips lines and refuses a missing name or a bad day count", () => {
    expect(parseValidDays("bank statement | 90\n\n  life insurance statement | 365 ")).toEqual([{ match: "bank statement", days: 90 }, { match: "life insurance statement", days: 365 }]);
    expect(validDaysText([{ match: "bank statement", days: 90 }])).toBe("bank statement | 90");
    expect(() => parseValidDays(" | 90")).toThrow(/text a document name contains/);
    expect(() => parseValidDays("bank statement | 0")).toThrow(/whole number of days/);
    expect(() => parseValidDays("bank statement | 12.5")).toThrow(/whole number of days/);
  });
  it("describes the rule, and an empty list as nothing expiring", () => {
    const entry = (value: unknown) => ({ rule_key: "document.valid_days", current: null, value, scheduled: [], history_count: 0 }) as BenefitsRuleEntry;
    expect(describeRule(entry([{ match: "bank statement", days: 90 }]))).toBe("bank statement: 90 days");
    expect(describeRule(entry([]))).toBe("No document expires");
  });
});
