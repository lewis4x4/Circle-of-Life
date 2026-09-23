import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  EMPTY_STAFF_ILLNESS_FORM,
  STAFF_ILLNESS_TYPE_OPTIONS,
  buildStaffIllnessInsert,
  staffIllnessFormProblems,
} from "./staff-illness-form";

const STAFF_ID = "00000000-0000-4000-8000-00000000d001";
const CONTEXT = {
  facilityId: "00000000-0000-4000-8000-0000000000f1",
  organizationId: "00000000-0000-4000-8000-0000000000a1",
  userId: "00000000-0000-4000-8000-0000000000b1",
  reportedDate: "2026-09-22",
};

const ADMIN_DIR = path.resolve(import.meta.dirname, "../../../app/(admin)/admin/infection-control/staff-illness");

describe("staff illness form", () => {
  it("starts empty and names every missing field", () => {
    expect(staffIllnessFormProblems(EMPTY_STAFF_ILLNESS_FORM)).toEqual([
      "Choose the staff member",
      "Choose the illness type",
      "Enter the first day absent",
    ]);
  });

  it("offers only the illness types the table accepts, in human text", () => {
    expect(STAFF_ILLNESS_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      "respiratory",
      "gi",
      "covid",
      "influenza",
      "skin",
      "other",
      "personal",
    ]);
    for (const option of STAFF_ILLNESS_TYPE_OPTIONS) expect(option.label).not.toContain("_");
  });

  it("rejects a return date before the first day absent", () => {
    expect(
      staffIllnessFormProblems({
        ...EMPTY_STAFF_ILLNESS_FORM,
        staffId: STAFF_ID,
        illnessType: "gi",
        absentFrom: "2026-09-20",
        absentTo: "2026-09-19",
      }),
    ).toEqual(["Return date cannot be before the first day absent"]);
  });

  it("builds a staff_illness_records insert at the selected facility", () => {
    expect(
      buildStaffIllnessInsert(
        {
          staffId: STAFF_ID,
          illnessType: "respiratory",
          symptoms: ["fever", "cough"],
          absentFrom: "2026-09-21",
          absentTo: "",
        },
        CONTEXT,
      ),
    ).toEqual({
      staff_id: STAFF_ID,
      facility_id: CONTEXT.facilityId,
      organization_id: CONTEXT.organizationId,
      reported_date: "2026-09-22",
      illness_type: "respiratory",
      symptoms: ["fever", "cough"],
      absent_from: "2026-09-21",
      absent_to: null,
      created_by: CONTEXT.userId,
    });
    expect(() => buildStaffIllnessInsert(EMPTY_STAFF_ILLNESS_FORM, CONTEXT)).toThrow();
  });
});

describe("staff illness routes", () => {
  const listSource = readFileSync(path.join(ADMIN_DIR, "page.tsx"), "utf8");

  it("the Log Illness link targets a page that exists (a missing route 404s on prefetch)", () => {
    expect(listSource).toContain('href="/admin/infection-control/staff-illness/new"');
    expect(existsSync(path.join(ADMIN_DIR, "new", "page.tsx"))).toBe(true);
  });

  it("the list never presents a failed load or an unscoped view as all clear", () => {
    expect(listSource).not.toContain("All Clear");
    expect(listSource).not.toContain("Surveillance Records");
    expect(listSource).toContain("loadError");
    expect(listSource).toContain("<FacilityGateNotice");
  });
});
