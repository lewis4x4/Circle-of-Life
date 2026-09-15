import { describe, expect, it } from "vitest";

import { buildForm1823AlignmentRoster, type RosterForm } from "./form-1823-alignment-roster";

function form(residentId: string, overrides: Partial<RosterForm> = {}): RosterForm {
  return {
    id: `form-${residentId}`,
    resident_id: residentId,
    exam_date: "2026-09-04",
    expiration_date: null,
    physician_name: null,
    examiner_title: null,
    allergies: null,
    prescribed_diet: null,
    medication_assistance: "self_administered",
    elopement_risk: false,
    adl_bathing: "assistance",
    adl_dressing: "independent",
    adl_eating: "independent",
    adl_transferring: "independent",
    adl_toileting: "independent",
    adl_grooming: "independent",
    adl_walking: "independent",
    condition_pressure_injury: false,
    physical_limitations: {},
    cognitive_behavioral_status: {},
    service_requirements: {},
    precautions: {},
    is_current: true,
    status: "received",
    ...overrides,
  };
}

const residents = [
  { id: "r-none", first_name: "No", last_name: "Form" },
  { id: "r-noplan", first_name: "No", last_name: "Plan" },
  { id: "r-gap", first_name: "Has", last_name: "Gap" },
  { id: "r-ok", first_name: "All", last_name: "Good" },
];

describe("buildForm1823AlignmentRoster", () => {
  it("puts residents with no 1823 first, then no plan, then gaps, then the aligned", () => {
    const roster = buildForm1823AlignmentRoster({
      residents,
      forms: [form("r-noplan"), form("r-gap"), form("r-ok")],
      plans: [
        { id: "p-gap", resident_id: "r-gap", version: 1 },
        { id: "p-ok", resident_id: "r-ok", version: 2 },
      ],
      items: [{ care_plan_id: "p-ok", category: "bathing", title: "Bathing", assistance_level: "limited_assist" }],
      today: "2026-09-15",
    });
    expect(roster.rows.map((r) => r.residentId)).toEqual(["r-none", "r-noplan", "r-gap", "r-ok"]);
    expect(roster.rows[0].form1823).toBeNull();
    expect(roster.rows[1].summary?.noPlan).toBe(true);
    expect(roster.rows[2].gaps).toEqual(["Bathing"]);
    expect(roster.rows[3].gaps).toEqual([]);
    expect(roster.counts).toEqual({ residents: 4, noForm1823: 1, noPlan: 1, withGaps: 1, expiredForm1823: 0 });
  });

  it("uses only the current received 1823, the newest when several are flagged current", () => {
    const roster = buildForm1823AlignmentRoster({
      residents: [residents[3]],
      forms: [
        form("r-ok", { id: "old", exam_date: "2024-01-01", adl_bathing: "dependent" }),
        form("r-ok", { id: "new", exam_date: "2026-09-04" }),
        form("r-ok", { id: "pending", exam_date: "2026-09-10", status: "pending" }),
      ],
      plans: [{ id: "p-ok", resident_id: "r-ok", version: 1 }],
      items: [{ care_plan_id: "p-ok", category: "bathing", title: "Bathing", assistance_level: "limited_assist" }],
      today: "2026-09-15",
    });
    expect(roster.rows[0].form1823?.id).toBe("new");
    expect(roster.rows[0].gaps).toEqual([]);
  });

  it("flags a 1823 older than three years even when the plan matches it", () => {
    const roster = buildForm1823AlignmentRoster({
      residents: [residents[3]],
      forms: [form("r-ok", { exam_date: "2023-06-01" })],
      plans: [{ id: "p-ok", resident_id: "r-ok", version: 1 }],
      items: [{ care_plan_id: "p-ok", category: "bathing", title: "Bathing", assistance_level: "limited_assist" }],
      today: "2026-09-15",
    });
    expect(roster.rows[0].form1823?.expired).toBe(true);
    expect(roster.rows[0].form1823?.ageLabel).toBe("Exam Jun 1, 2023 — older than 3 years or expired");
    expect(roster.counts.expiredForm1823).toBe(1);
  });
});
