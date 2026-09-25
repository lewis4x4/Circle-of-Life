import { describe, expect, it } from "vitest";

import { getRoleDashboardConfig } from "@/lib/auth/dashboard-routing";
import { pillarsForRole, resolveNavAnchor } from "@/lib/navigation/pillars";

const hasIntake = (role: string) =>
  pillarsForRole(getRoleDashboardConfig(role), role).some((pillar) => pillar.items.some((item) => item.key === "document-intake"));

describe("Document Intake navigation (COL-771)", () => {
  it.each(["owner", "org_admin", "facility_admin", "manager", "admin_assistant", "coordinator"])("is in the %s menu", (role) => {
    expect(hasIntake(role)).toBe(true);
  });

  it.each(["med_tech", "cook", "housekeeper", "recruiter", "family", "broker"])("is not in the %s menu", (role) => {
    expect(hasIntake(role)).toBe(false);
  });

  it("anchors the review page to the Command pillar item", () => {
    expect(resolveNavAnchor("/admin/document-intake/00000000-0000-4000-8000-000000000001")).toMatchObject({ pillarId: "command", item: { key: "document-intake" } });
  });
});
