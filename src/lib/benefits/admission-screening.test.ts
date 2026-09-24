import { describe, expect, it } from "vitest";

import { classifyAdmissionScreening, parseDollarsToCents, screeningQuestionText } from "./admission-screening";
import { admissionGateSchema, admissionScreeningSchema, type AdmissionGate } from "./contracts";

// The owner rule seeded by migration 507 (Brian, 2026-09-24).
const gate: AdmissionGate = { disqualify: ["q_property_non_primary", "q_income_over_limit", "q_assets"], income_limit_cents: 282900, assets_limit_cents: 200000 };
const allNo = { q_property_non_primary: "no", q_income_over_limit: "no", q_life_insurance: "no", q_burial_contract: "no", q_assets: "no", q_power_of_attorney: "no" } as const;
const classify = (over: Record<string, string> = {}, income?: number | null, assets?: number | null, coverage: Parameters<typeof classifyAdmissionScreening>[0] = "private_pay") =>
  classifyAdmissionScreening(coverage, { ...allNo, ...over } as never, income, assets, gate).result;

// Each case mirrors a haven.benefits_screening_classify assertion in supabase/tests/review_benefits_admission_screening.sql.
describe("admission Medicaid screening classification", () => {
  it("all no is a candidate, including a gold-card resident", () => {
    expect(classify()).toBe("candidate");
    expect(classify({}, null, null, "medicaid_mma")).toBe("candidate");
  });
  it("non-primary property, income over the limit, or assets over the limit stop", () => {
    expect(classify({ q_property_non_primary: "yes" })).toBe("not_qualified_now");
    expect(classify({ q_income_over_limit: "yes" })).toBe("not_qualified_now");
    expect(classify({ q_assets: "yes" }, null, 200001)).toBe("not_qualified_now");
  });
  it("life insurance, burial contract and power of attorney never stop on their own", () => {
    expect(classify({ q_life_insurance: "yes", q_burial_contract: "yes", q_power_of_attorney: "yes" })).toBe("candidate");
  });
  it("unknown is never treated as no", () => {
    expect(classify({ q_income_over_limit: "unknown" })).toBe("needs_answers");
    expect(classify({ q_assets: "yes" })).toBe("needs_answers");
  });
  it("a stated amount answers its question at the limit boundary", () => {
    expect(classify({ q_income_over_limit: "unknown" }, 282901)).toBe("not_qualified_now");
    expect(classify({ q_income_over_limit: "unknown" }, 282900)).toBe("candidate");
    expect(classify({ q_assets: "yes" }, null, 200000)).toBe("candidate");
  });
  it("an answer that contradicts the amount goes to a person", () => {
    expect(classify({}, 300000)).toBe("needs_answers");
    expect(classify({}, null, 500000)).toBe("needs_answers");
  });
  it("enrolled residents are tracked, not screened", () => {
    expect(classify({ q_property_non_primary: "yes" }, null, null, "smmc_ltc_enrolled")).toBe("already_enrolled");
  });
  it("the income question shows the rule's limit", () => {
    expect(screeningQuestionText("q_income_over_limit", gate)).toBe("Is your income over $2,829.00 per month?");
  });
});

describe("screening contracts", () => {
  it("rejects unknown questions in the gate rule and extra fields in an answer set", () => {
    expect(admissionGateSchema.safeParse({ ...gate, disqualify: ["q_other"] }).success).toBe(false);
    expect(admissionGateSchema.safeParse({ ...gate, disqualify: ["q_assets", "q_assets"] }).success).toBe(false);
    const base = { resident_id: "11111111-1111-4111-8111-111111111111", source: "admission", coverage: "none", ...allNo };
    expect(admissionScreeningSchema.safeParse(base).success).toBe(true);
    expect(admissionScreeningSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(admissionScreeningSchema.safeParse({ ...base, q_assets: "maybe" }).success).toBe(false);
  });
  it("parses dollars into whole cents and flags nonsense", () => {
    expect(parseDollarsToCents("$2,829.00")).toBe(282900);
    expect(parseDollarsToCents("1500.5")).toBe(150050);
    expect(parseDollarsToCents("")).toBeNull();
    expect(parseDollarsToCents("12.345")).toBeNaN();
    expect(parseDollarsToCents("abc")).toBeNaN();
  });
});
