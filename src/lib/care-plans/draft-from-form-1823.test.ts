import { describe, expect, it } from "vitest";

import { draftCarePlanFromForm1823, form1823SectionText, type Form1823DraftSource } from "./draft-from-form-1823";

// Synthetic, shaped like a typical admission 1823: all ADLs "A", med assistance, elopement yes.
function source(overrides: Partial<Form1823DraftSource> = {}): Form1823DraftSource {
  return {
    id: "f1823",
    exam_date: "2026-09-04",
    physician_name: "Examiner Example",
    examiner_title: "APRN",
    allergies: ["NKA"],
    prescribed_diet: "Regular",
    medication_assistance: "assistance_with_self_administration",
    elopement_risk: true,
    adl_bathing: "assistance",
    adl_dressing: "assistance",
    adl_eating: "assistance",
    adl_transferring: "assistance",
    adl_toileting: "assistance",
    adl_grooming: "assistance",
    adl_walking: "assistance",
    condition_pressure_injury: false,
    physical_limitations: { text: "Wheelchair for ambulation, self propels" },
    cognitive_behavioral_status: { text: "Dementia" },
    service_requirements: { text: "Medication management" },
    precautions: {},
    ...overrides,
  };
}

describe("draftCarePlanFromForm1823", () => {
  it("drafts one line per ADL, medication, elopement, cognition and diet, with every open judgment as a gap", () => {
    const draft = draftCarePlanFromForm1823(source(), { today: "2026-09-15" });

    expect(draft.items.map((i) => `${i.category}:${i.title}`)).toEqual([
      "mobility:Ambulation",
      "mobility:Transferring",
      "bathing:Bathing",
      "dressing:Dressing",
      "grooming:Self-care (grooming)",
      "toileting:Toileting",
      "eating:Eating",
      "medication_assistance:Medications",
      "behavioral:Elopement precautions",
      "cognitive:Cognitive / behavioral status",
      "dietary:Diet: Regular",
    ]);
    // "A" on the 1823 becomes limited_assist and is flagged, seven times.
    const adl = draft.items.slice(0, 7);
    expect(adl.every((i) => i.assistance_level === "limited_assist")).toBe(true);
    expect(draft.gaps.filter((g) => g.message.includes("needs assistance"))).toHaveLength(7);
    // Mobility lines carry the physical limitation as special instructions; others do not.
    expect(draft.items[0].special_instructions).toBe("Wheelchair for ambulation, self propels");
    expect(draft.items[2].special_instructions).toBe("");
    // Medication §2B choice maps to limited assist with the unlicensed-staff intervention.
    expect(draft.items[7]).toMatchObject({ assistance_level: "limited_assist" });
    expect(draft.items[7].interventions[0]).toMatch(/Unlicensed staff assist/);
    // Elopement: line with no interventions, plus a gap asking for them.
    expect(draft.items[8].interventions).toEqual([]);
    expect(draft.gaps.some((g) => g.title === "Elopement precautions")).toBe(true);
    expect(draft.items[9].description).toBe("Dementia (per the Form 1823 exam Sep 4, 2026)");
  });

  it("sets effective today and review twelve months out, and names the source in the notes", () => {
    const draft = draftCarePlanFromForm1823(source(), { today: "2026-09-15" });
    expect(draft.effectiveDate).toBe("2026-09-15");
    expect(draft.reviewDueDate).toBe("2027-09-15");
    expect(draft.notes).toBe(
      "Drafted from Form 1823 exam Sep 4, 2026, examiner Examiner Example (APRN). Allergies: NKA. Nursing / treatment / therapy per 1823: Medication management.",
    );
    expect(draftCarePlanFromForm1823(source(), { today: "2026-01-31", reviewMonths: 1 }).reviewDueDate).toBe("2026-02-28");
  });

  it("leaves an unassessed ADL blank so the editor blocks save until the nurse chooses", () => {
    const draft = draftCarePlanFromForm1823(source({ adl_eating: "not_assessed", adl_toileting: null }), { today: "2026-09-15" });
    const eating = draft.items.find((i) => i.title === "Eating")!;
    const toileting = draft.items.find((i) => i.title === "Toileting")!;
    expect(eating.assistance_level).toBe("");
    expect(toileting.assistance_level).toBe("");
    expect(draft.gaps.filter((g) => g.message.includes("does not assess"))).toHaveLength(2);
  });

  it("maps independent, supervision and dependent without flagging them", () => {
    const draft = draftCarePlanFromForm1823(
      source({ adl_bathing: "independent", adl_dressing: "supervision", adl_eating: "dependent", elopement_risk: false, medication_assistance: "self_administered" }),
      { today: "2026-09-15" },
    );
    expect(draft.items.find((i) => i.title === "Bathing")!.assistance_level).toBe("independent");
    expect(draft.items.find((i) => i.title === "Dressing")!.assistance_level).toBe("supervision");
    expect(draft.items.find((i) => i.title === "Eating")!.assistance_level).toBe("total_dependence");
    expect(draft.items.find((i) => i.title === "Medications")!.assistance_level).toBe("independent");
    expect(draft.items.some((i) => i.title === "Elopement precautions")).toBe(false);
    expect(draft.gaps.filter((g) => ["Bathing", "Dressing", "Eating"].includes(g.title ?? ""))).toHaveLength(0);
  });

  it("adds a skin line and gap for a pressure injury, and a medication gap when §2B is blank", () => {
    const draft = draftCarePlanFromForm1823(
      source({ condition_pressure_injury: true, medication_assistance: null, allergies: [], service_requirements: {} }),
      { today: "2026-09-15" },
    );
    expect(draft.items.some((i) => i.category === "skin_integrity")).toBe(true);
    expect(draft.items.some((i) => i.category === "medication_assistance")).toBe(false);
    expect(draft.gaps.some((g) => g.message.startsWith("Medications:"))).toBe(true);
    expect(draft.notes).toContain("Allergies: none listed on the 1823.");
  });
});

describe("form1823SectionText", () => {
  it("flattens whatever shape intake stored into one line", () => {
    expect(form1823SectionText({ text: "Dementia" })).toBe("Dementia");
    expect(form1823SectionText({ items: ["Wheelchair", " self propels "], noted: true })).toBe("Wheelchair; self propels; true");
    expect(form1823SectionText(null)).toBe("");
    expect(form1823SectionText({})).toBe("");
  });
});
