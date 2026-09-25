import { describe, expect, it } from "vitest";

import {
  buildStaffProfileSectionPatch,
  canEditStaffProfile,
  staffProfileDraftFromRow,
  staffProfileEmploymentStatusOptions,
  staffRateCentsToDollarInput,
  staffRateDollarInputToCents,
  type StaffProfileDraft,
  type StaffProfileRow,
} from "./staff-profile-edit";

function baseRow(overrides: Partial<StaffProfileRow> = {}): StaffProfileRow {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    facility_id: "11111111-1111-1111-1111-111111111111",
    user_id: null,
    first_name: "Roster",
    last_name: "Example",
    preferred_name: null,
    phone: "555-0100 x412",
    phone_alt: null,
    email: "roster.example@example.test",
    address_line_1: null,
    address_line_2: null,
    city: null,
    state: null,
    zip: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    emergency_contact_relationship: null,
    staff_role: "cna",
    employment_status: "active",
    hire_date: "2024-01-15",
    termination_date: null,
    termination_reason: null,
    hourly_rate: 1850,
    overtime_rate: null,
    is_full_time: true,
    is_float_pool: false,
    max_hours_per_week: 40,
    photo_url: null,
    notes: null,
    updated_at: "2026-01-01T12:00:00Z",
    ...overrides,
  };
}

function baseDraft(overrides: Partial<StaffProfileDraft> = {}): StaffProfileDraft {
  return { ...staffProfileDraftFromRow(baseRow()), ...overrides };
}

describe("canEditStaffProfile", () => {
  it("allows owner, org_admin, and facility_admin only", () => {
    expect(canEditStaffProfile("owner")).toBe(true);
    expect(canEditStaffProfile("org_admin")).toBe(true);
    expect(canEditStaffProfile("facility_admin")).toBe(true);
    expect(canEditStaffProfile("med_tech")).toBe(false);
    expect(canEditStaffProfile("manager")).toBe(false);
    expect(canEditStaffProfile("")).toBe(false);
  });
});

describe("staffProfileEmploymentStatusOptions", () => {
  it("offers active and on_leave for typical staff", () => {
    const opts = staffProfileEmploymentStatusOptions("active");
    expect(opts.map((o) => o.value)).toEqual(["active", "on_leave"]);
  });

  it("keeps terminated profiles on the offboard command instead of a casual active option", () => {
    const opts = staffProfileEmploymentStatusOptions("terminated");
    expect(opts.map((o) => o.value)).toEqual(["terminated"]);
  });

  it("retains suspended when current status is suspended", () => {
    const opts = staffProfileEmploymentStatusOptions("suspended");
    expect(opts.map((o) => o.value)).toContain("suspended");
  });
});

describe("staff rate cents helpers", () => {
  it("converts cents to dollar input without float drift", () => {
    expect(staffRateCentsToDollarInput(1850)).toBe("18.50");
    expect(staffRateCentsToDollarInput(1800)).toBe("18");
    expect(staffRateCentsToDollarInput(null)).toBe("");
  });

  it("parses dollar input to integer cents via whole and fraction", () => {
    expect(staffRateDollarInputToCents("18.50")).toEqual({ ok: true, cents: 1850 });
    expect(staffRateDollarInputToCents("18.5")).toEqual({ ok: true, cents: 1850 });
    expect(staffRateDollarInputToCents("")).toEqual({ ok: true, cents: null });
    expect(staffRateDollarInputToCents("abc").ok).toBe(false);
  });
});

describe("buildStaffProfileSectionPatch", () => {
  const updatedBy = "user-editor-1";

  it("requires first and last name on name section", () => {
    const draft = baseDraft({ first_name: "  ", last_name: "Example" });
    const res = buildStaffProfileSectionPatch("name", draft, updatedBy, "active");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/required/i);
  });

  it("maps blank optional contact fields to null", () => {
    const draft = baseDraft({ phone: "   ", email: "", phone_alt: " " });
    const res = buildStaffProfileSectionPatch("contact", draft, updatedBy, "active");
    expect(res).toEqual({
      ok: true,
      patch: {
        updated_by: updatedBy,
        phone: null,
        phone_alt: null,
        email: null,
      },
    });
  });

  it("requires hire date on employment section", () => {
    const draft = baseDraft({ hire_date: "" });
    const res = buildStaffProfileSectionPatch("employment", draft, updatedBy, "active");
    expect(res.ok).toBe(false);
  });

  it("refuses a casual terminate from the employment section", () => {
    const draft = baseDraft({ employment_status: "terminated" });
    const res = buildStaffProfileSectionPatch("employment", draft, updatedBy, "active");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Offboard/);
  });

  it("includes float pool and schedule on employment patch", () => {
    const draft = baseDraft({ is_float_pool: true, is_full_time: false, max_hours_per_week: "" });
    const res = buildStaffProfileSectionPatch("employment", draft, updatedBy, "active");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.patch.is_float_pool).toBe(true);
      expect(res.patch.is_full_time).toBe(false);
      expect(res.patch.max_hours_per_week).toBeNull();
    }
  });

  it("writes the position on the employment patch", () => {
    const draft = baseDraft({ staff_role: "medication_tech" });
    const res = buildStaffProfileSectionPatch("employment", draft, updatedBy, "active");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.patch.staff_role).toBe("medication_tech");
  });

  it("requires a position on the employment section", () => {
    const res = buildStaffProfileSectionPatch("employment", baseDraft({ staff_role: " " }), updatedBy, "active");
    expect(res).toEqual({ ok: false, error: "Position is required." });
  });

  it("writes compensation rates as integer cents", () => {
    const draft = baseDraft({ hourly_rate_dollars: "22.75", overtime_rate_dollars: "" });
    const res = buildStaffProfileSectionPatch("compensation", draft, updatedBy, "active");
    expect(res).toEqual({
      ok: true,
      patch: {
        updated_by: updatedBy,
        hourly_rate: 2275,
        overtime_rate: null,
      },
    });
  });
});

describe("staffProfileDraftFromRow", () => {
  it("round-trips legacy phone extension in draft", () => {
    const draft = staffProfileDraftFromRow(baseRow({ phone: "555-0100 x412" }));
    expect(draft.phone).toBe("555-0100 x412");
  });
});
