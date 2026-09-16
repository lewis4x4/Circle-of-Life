import { describe, expect, it } from "vitest";

import { buildForm1823AlignmentRoster, resolveForm1823RowAction, type RosterForm } from "./form-1823-alignment-roster";

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

const bathingLine = { category: "bathing", title: "Bathing", assistance_level: "limited_assist" };

describe("buildForm1823AlignmentRoster", () => {
  it("puts residents with no 1823 first, then no plan, then gaps, then the answered", () => {
    const roster = buildForm1823AlignmentRoster({
      residents,
      forms: [form("r-noplan"), form("r-gap"), form("r-ok")],
      plans: [
        { id: "p-gap", resident_id: "r-gap", version: 1 },
        { id: "p-ok", resident_id: "r-ok", version: 2 },
      ],
      items: [{ care_plan_id: "p-ok", ...bathingLine }],
      today: "2026-09-15",
    });
    expect(roster.rows.map((r) => r.residentId)).toEqual(["r-none", "r-noplan", "r-gap", "r-ok"]);
    expect(roster.rows.map((r) => r.alignment)).toEqual(["cannot_assess", "no_plan", "gaps", "answered"]);
    expect(roster.rows[0].form1823).toBeNull();
    expect(roster.rows[0].summary).toBeNull();
    expect(roster.rows[1].summary).toBeNull();
    expect(roster.rows[2].gaps).toEqual(["Bathing"]);
    expect(roster.rows[3].gaps).toEqual([]);
    expect(roster.rows[3].summary?.addressed).toBeGreaterThan(0);
  });

  it("counts every state against the same resident population as the rows", () => {
    const roster = buildForm1823AlignmentRoster({
      residents,
      forms: [form("r-noplan"), form("r-gap"), form("r-ok")],
      plans: [
        { id: "p-gap", resident_id: "r-gap", version: 1 },
        { id: "p-ok", resident_id: "r-ok", version: 2 },
      ],
      items: [{ care_plan_id: "p-ok", ...bathingLine }],
      today: "2026-09-15",
    });
    // r-none has no plan either: the summary must say 2, not 1, or it
    // contradicts the two rows that read "No active plan".
    expect(roster.counts).toEqual({
      residents: 4,
      noForm1823: 1,
      noPlan: 2,
      cannotAssess: 1,
      compared: 2,
      withGaps: 1,
      answered: 1,
      expiredForm1823: 0,
      overAgeForm1823: 0,
    });
    expect(roster.counts.noPlan).toBe(roster.rows.filter((r) => r.plan === null).length);
    expect(roster.counts.noForm1823).toBe(roster.rows.filter((r) => r.form1823 === null).length);
    expect(roster.counts.withGaps).toBe(roster.rows.filter((r) => r.alignment === "gaps").length);
  });

  it("reports a facility with no 1823s at all as nothing assessable, not as zero gaps", () => {
    const roster = buildForm1823AlignmentRoster({ residents, forms: [], plans: [], items: [], today: "2026-09-15" });
    expect(roster.counts.residents).toBe(4);
    expect(roster.counts.noForm1823).toBe(4);
    expect(roster.counts.noPlan).toBe(4);
    expect(roster.counts.cannotAssess).toBe(4);
    expect(roster.counts.compared).toBe(0);
    expect(roster.counts.withGaps).toBe(0);
    expect(roster.counts.answered).toBe(0);
    expect(roster.rows.every((r) => r.alignment === "cannot_assess")).toBe(true);
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
      items: [{ care_plan_id: "p-ok", ...bathingLine }],
      today: "2026-09-15",
    });
    expect(roster.rows[0].form1823?.id).toBe("new");
    expect(roster.rows[0].alignment).toBe("answered");
  });

  it("tells a 1823 expired by its own date apart from one older than three years", () => {
    const roster = buildForm1823AlignmentRoster({
      residents: [residents[2], residents[3]],
      forms: [form("r-gap", { exam_date: "2026-01-01", expiration_date: "2026-09-01" }), form("r-ok", { exam_date: "2023-06-01" })],
      plans: [
        { id: "p-gap", resident_id: "r-gap", version: 1 },
        { id: "p-ok", resident_id: "r-ok", version: 1 },
      ],
      items: [
        { care_plan_id: "p-gap", ...bathingLine },
        { care_plan_id: "p-ok", ...bathingLine },
      ],
      today: "2026-09-15",
    });
    const byId = new Map(roster.rows.map((r) => [r.residentId, r]));
    expect(byId.get("r-gap")?.form1823?.age).toBe("expired");
    expect(byId.get("r-gap")?.form1823?.ageLabel).toBe("Exam Jan 1, 2026 · expired Sep 1, 2026");
    expect(byId.get("r-ok")?.form1823?.age).toBe("over_age");
    expect(byId.get("r-ok")?.form1823?.ageLabel).toBe("Exam Jun 1, 2023 · older than 3 years");
    // A stale form is still compared; the plan answered it, so it stays "answered".
    expect(byId.get("r-ok")?.alignment).toBe("answered");
    expect(roster.counts.expiredForm1823).toBe(1);
    expect(roster.counts.overAgeForm1823).toBe(1);
  });

  it("names the action after what the destination can do", () => {
    const roster = buildForm1823AlignmentRoster({
      residents,
      forms: [form("r-noplan"), form("r-gap"), form("r-ok")],
      plans: [
        { id: "p-gap", resident_id: "r-gap", version: 1 },
        { id: "p-ok", resident_id: "r-ok", version: 2 },
      ],
      items: [{ care_plan_id: "p-ok", ...bathingLine }],
      admissionCases: [
        { id: "case-cancelled", resident_id: "r-none", status: "cancelled", created_at: "2026-09-10T00:00:00Z" },
        { id: "case-open", resident_id: "r-none", status: "move_in", created_at: "2026-09-01T00:00:00Z" },
      ],
      today: "2026-09-15",
    });
    const byId = new Map(roster.rows.map((r) => [r.residentId, r]));
    expect(byId.get("r-none")?.action).toEqual({ label: "Record Form 1823", href: "/admin/admissions/case-open" });
    expect(byId.get("r-noplan")?.action).toEqual({ label: "Open care plan", href: "/admin/residents/r-noplan/care-plan" });
    expect(byId.get("r-gap")?.action).toEqual({ label: "Review alignment", href: "/admin/residents/r-gap/care-plan" });
    expect(byId.get("r-ok")?.action).toEqual({ label: "Review alignment", href: "/admin/residents/r-ok/care-plan" });
  });

  it("sends a resident with no 1823 and no admission case to the resident record", () => {
    expect(resolveForm1823RowAction({ residentId: "r", hasForm: false, hasPlan: false, admissionCaseId: null })).toEqual({
      label: "Open resident",
      href: "/admin/residents/r",
    });
  });
});
