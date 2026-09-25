import { describe, expect, it } from "vitest";

import { buildScreeningSheet, screeningSheetFactsSchema, type ScreeningSheetFacts } from "./screening-sheet";

const empty: ScreeningSheetFacts = {
  case_id: "11111111-1111-4111-8111-111111111111",
  resident: { first_name: "Anon", middle_name: null, last_name: "Resident", date_of_birth: "1940-02-03", gender: "female", phone: null },
  facility: { name: "Anon House", address_line_1: "1 Probe Way", city: "Probeville", zip: "00000" },
  medicaid_number: null, screening: null, forms_1823: [], active_medication_count: 0,
};
const items = (facts: ScreeningSheetFacts) => buildScreeningSheet(facts).flatMap((s) => s.items);
const find = (facts: ScreeningSheetFacts, q: string) => items(facts).filter((i) => i.q === q);

describe("701S sheet mapping", () => {
  it("fills demographics and location from the record, each with its source", () => {
    expect(find(empty, "3a")[0]).toMatchObject({ answer: "Anon", source: "Resident record" });
    expect(find(empty, "6")[0].answer).toBe("02/03/1940");
    expect(find(empty, "7")[0].answer).toBe("Female");
    expect(find(empty, "13d")[0]).toMatchObject({ answer: "Assisted living facility (ALF)", source: "Facility record" });
    expect(find(empty, "22")[0]).toMatchObject({ answer: "With other", source: "Lives at Anon House (ALF)" });
  });
  it("leaves every answer the record does not hold blank, with no canned answers", () => {
    for (const q of ["2", "3b", "4", "5", "8", "21", "23", "25", "29", "30", "31", "33", "36", "38a", "40g", "57"]) {
      expect(find(empty, q)[0]).toMatchObject({ answer: null, source: null });
    }
    const answered = items(empty).filter((i) => i.answer);
    expect(answered.map((i) => i.q).sort()).toEqual(["13a", "13b", "13c", "13d", "13e", "22", "3a", "3c", "6", "7"].sort());
  });
  it("takes income and assets from the latest screening", () => {
    const facts = { ...empty, screening: { answered_at: "2026-09-20T12:00:00Z", monthly_income_cents: 150000, assets_cents: 180000 } };
    expect(find(facts, "23")[0]).toMatchObject({ answer: "$1,500.00", source: "Medicaid questions answered 09/20/2026" });
    expect(find(facts, "25")[0].answer).toBe("$1,800.00 ($0 to $2,000)");
  });
  it("lists diagnoses from every 1823 and ADLs from the current one", () => {
    const form = (id: string, exam: string, current: boolean, diagnoses: string[], bathing: string | null) => ({
      id, exam_date: exam, status: "received", is_current: current, diagnoses, adl_bathing: bathing, adl_dressing: null, adl_eating: "not_assessed",
      adl_toileting: null, adl_transferring: null, adl_walking: null, medication_assistance: current ? "administered_by_licensed_staff" : null,
    });
    const facts = screeningSheetFactsSchema.parse({ ...empty, forms_1823: [
      form("22222222-2222-4222-8222-222222222222", "2026-06-01", true, ["Diagnosis B"], "assistance"),
      form("33333333-3333-4333-8333-333333333333", "2025-06-01", false, ["Diagnosis A", ""], "independent"),
    ] });
    expect(find(facts, "42").map((i) => [i.answer, i.source])).toEqual([["Diagnosis B", "1823 dated 06/01/2026"], ["Diagnosis A", "1823 dated 06/01/2025"]]);
    expect(find(facts, "38a")[0]).toMatchObject({ answer: "Needs assistance (but not total help)", source: "1823 dated 06/01/2026: assistance" });
    expect(find(facts, "38c")[0].answer).toBeNull();
    expect(find(facts, "40g")[0].answer).toBe("Needs total assistance (cannot do at all)");
  });
  it("answers the medication question only from the active list", () => {
    expect(find({ ...empty, active_medication_count: 3 }, "57")[0]).toMatchObject({ answer: "Yes", source: "Active medication list: 3" });
    expect(find({ ...empty, active_medication_count: 2 }, "57")[0].answer).toBe("No");
    expect(find(empty, "57")[0].answer).toBeNull();
  });
});
