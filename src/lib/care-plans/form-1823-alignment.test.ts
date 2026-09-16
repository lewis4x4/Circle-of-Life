import { describe, expect, it } from "vitest";

import type { Form1823DraftSource } from "./draft-from-form-1823";
import { alignForm1823WithPlan, form1823AgeState, formatForm1823AgeLabel, type AlignmentPlanItem } from "./form-1823-alignment";

function form(overrides: Partial<Form1823DraftSource> = {}): Form1823DraftSource {
  return {
    id: "f",
    exam_date: "2026-09-04",
    physician_name: null,
    examiner_title: null,
    allergies: null,
    prescribed_diet: "Regular",
    medication_assistance: "assistance_with_self_administration",
    elopement_risk: true,
    adl_bathing: "assistance",
    adl_dressing: "assistance",
    adl_eating: "independent",
    adl_transferring: "assistance",
    adl_toileting: "supervision",
    adl_grooming: "assistance",
    adl_walking: "assistance",
    condition_pressure_injury: false,
    physical_limitations: {},
    cognitive_behavioral_status: { text: "Dementia" },
    service_requirements: {},
    precautions: {},
    ...overrides,
  };
}

const fullPlan: AlignmentPlanItem[] = [
  { category: "mobility", title: "Ambulation", assistance_level: "limited_assist" },
  { category: "mobility", title: "Transferring", assistance_level: "extensive_assist" },
  { category: "bathing", title: "Bathing", assistance_level: "limited_assist" },
  { category: "dressing", title: "Dressing", assistance_level: "supervision" },
  { category: "grooming", title: "Grooming", assistance_level: "limited_assist" },
  { category: "toileting", title: "Toileting", assistance_level: "supervision" },
  { category: "eating", title: "Eating", assistance_level: "independent" },
  { category: "medication_assistance", title: "Medications", assistance_level: "limited_assist" },
  { category: "behavioral", title: "Elopement precautions", assistance_level: "supervision" },
  { category: "cognitive", title: "Cognitive status", assistance_level: "supervision" },
  { category: "dietary", title: "Diet: Regular", assistance_level: "supervision" },
];

describe("alignForm1823WithPlan", () => {
  it("marks a need addressed when the plan meets or exceeds the 1823, weaker when it does not", () => {
    const { rows, summary } = alignForm1823WithPlan(form(), fullPlan);
    const byNeed = Object.fromEntries(rows.map((r) => [r.need, r]));
    expect(byNeed["Ambulation"].state).toBe("addressed");
    expect(byNeed["Transferring"].state).toBe("addressed");
    expect(byNeed["Dressing"]).toMatchObject({ form1823: "Needs assistance", plan: "Supervision", state: "weaker" });
    expect(byNeed["Eating"].state).toBe("addressed");
    expect(byNeed["Medications"].state).toBe("addressed");
    expect(byNeed["Elopement precautions"].state).toBe("addressed");
    expect(byNeed["Cognitive / behavioral status"].state).toBe("addressed");
    expect(byNeed["Diet"].state).toBe("addressed");
    expect(summary).toEqual({ addressed: 10, weaker: 1, notAddressed: 0, notAssessed: 0, noPlan: false });
  });

  it("names every need not addressed when lines are missing, and no_plan when there is no active plan", () => {
    const { rows, summary } = alignForm1823WithPlan(form(), [{ category: "bathing", title: "Bathing", assistance_level: "limited_assist" }]);
    expect(rows.find((r) => r.need === "Bathing")!.state).toBe("addressed");
    expect(rows.find((r) => r.need === "Ambulation")!.state).toBe("not_addressed");
    expect(rows.find((r) => r.need === "Medications")!.state).toBe("not_addressed");
    // Eating is independent on this 1823, so no line is owed for it.
    expect(summary.notAddressed).toBe(9);

    const none = alignForm1823WithPlan(form(), null);
    expect(none.summary.noPlan).toBe(true);
    expect(none.rows.every((r) => r.state === "no_plan" || r.state === "not_assessed")).toBe(true);
  });

  it("owes no line for an ADL the 1823 marks independent", () => {
    const { rows } = alignForm1823WithPlan(form({ adl_walking: "independent" }), [{ category: "bathing", title: "Bathing", assistance_level: "limited_assist" }]);
    expect(rows.find((r) => r.need === "Ambulation")).toMatchObject({ plan: "No line needed", state: "addressed" });
    expect(rows.find((r) => r.need === "Eating")).toMatchObject({ plan: "No line needed", state: "addressed" });
    expect(rows.find((r) => r.need === "Dressing")!.state).toBe("not_addressed");
  });

  it("reports unassessed 1823 fields as the form's gap, not the plan's", () => {
    const { rows } = alignForm1823WithPlan(form({ adl_eating: "not_assessed", medication_assistance: null, elopement_risk: null }), fullPlan);
    expect(rows.find((r) => r.need === "Eating")).toMatchObject({ form1823: "Not assessed on the 1823", state: "not_assessed" });
    expect(rows.find((r) => r.need === "Medications")!.state).toBe("not_assessed");
    expect(rows.find((r) => r.need === "Elopement precautions")!.state).toBe("not_assessed");
  });

  it("lets one generic mobility line answer both mobility needs, but not two specific ones the wrong way round", () => {
    const generic = alignForm1823WithPlan(form(), [{ category: "mobility", title: "Mobility", assistance_level: "extensive_assist" }]);
    expect(generic.rows.find((r) => r.need === "Ambulation")!.state).toBe("addressed");
    expect(generic.rows.find((r) => r.need === "Transferring")!.state).toBe("addressed");

    const onlyTransfers = alignForm1823WithPlan(form(), [{ category: "mobility", title: "Transferring", assistance_level: "extensive_assist" }]);
    expect(onlyTransfers.rows.find((r) => r.need === "Ambulation")!.state).toBe("not_addressed");
  });

  it("treats a self-administering resident as needing no medication line, and licensed administration as needing extensive assist", () => {
    const self = alignForm1823WithPlan(form({ medication_assistance: "self_administered" }), []);
    expect(self.rows.find((r) => r.need === "Medications")).toMatchObject({ state: "addressed", plan: "No medication line (none needed)" });
    const licensed = alignForm1823WithPlan(form({ medication_assistance: "administered_by_licensed_staff" }), [{ category: "medication_assistance", title: "Medications", assistance_level: "limited_assist" }]);
    expect(licensed.rows.find((r) => r.need === "Medications")!.state).toBe("weaker");
  });

  it("adds a skin row only when the 1823 marks a pressure sore, and omits elopement when marked No", () => {
    const { rows } = alignForm1823WithPlan(form({ condition_pressure_injury: true, elopement_risk: false }), []);
    expect(rows.some((r) => r.need === "Pressure injury care" && r.state === "not_addressed")).toBe(true);
    expect(rows.some((r) => r.need === "Elopement precautions")).toBe(false);
  });
});

describe("form1823AgeState", () => {
  it("tells the record's own expiration apart from the three-year statutory ceiling", () => {
    expect(form1823AgeState("2026-09-04", null, "2026-09-15")).toBe("current");
    expect(form1823AgeState("2023-09-14", null, "2026-09-15")).toBe("over_age");
    expect(form1823AgeState("2023-09-15", null, "2026-09-15")).toBe("current");
    expect(form1823AgeState("2026-09-04", "2026-09-10", "2026-09-15")).toBe("expired");
    // Both breached: the facility's own date is the one staff set, so it wins.
    expect(form1823AgeState("2020-01-01", "2021-01-01", "2026-09-15")).toBe("expired");
    expect(form1823AgeState(null, null, "2026-09-15")).toBe("unknown");
    expect(formatForm1823AgeLabel("2023-01-01", null, "2026-09-15")).toBe("Exam Jan 1, 2023 · older than 3 years");
    expect(formatForm1823AgeLabel("2026-09-04", "2026-09-10", "2026-09-15")).toBe("Exam Sep 4, 2026 · expired Sep 10, 2026");
    expect(formatForm1823AgeLabel("2026-09-04", null, "2026-09-15")).toBe("Exam Sep 4, 2026");
    expect(formatForm1823AgeLabel(null, null, "2026-09-15")).toBe("Exam date not recorded");
  });
});
