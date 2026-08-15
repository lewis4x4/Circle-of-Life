import { describe, expect, it } from "vitest";

import {
  adminResidentDetailHrefs,
  residentDetailTabFromSegment,
} from "@/lib/residents/resident-detail-navigation";

describe("resident detail navigation", () => {
  it("builds every resident workspace link from the canonical admin route", () => {
    expect(adminResidentDetailHrefs("resident-123")).toEqual({
      rosterHref: "/admin/residents",
      residentRootHref: "/admin/residents/resident-123",
      overviewHref: "/admin/residents/resident-123",
      assessmentsHref: "/admin/residents/resident-123/assessments",
      carePlanHref: "/admin/residents/resident-123/care-plan",
      medicationsHref: "/admin/residents/resident-123/medications",
      vitalsHref: "/admin/residents/resident-123/vitals",
      billingHref: "/admin/residents/resident-123/billing",
    });
  });

  it.each([
    [null, "overview"],
    ["assessments", "assessments"],
    ["care-plan", "care-plan"],
    ["medications", "medications"],
    ["vitals", "vitals"],
    ["billing", "billing"],
    ["unknown", "overview"],
  ] as const)("maps the %s route segment to the %s tab", (segment, tab) => {
    expect(residentDetailTabFromSegment(segment)).toBe(tab);
  });
});
