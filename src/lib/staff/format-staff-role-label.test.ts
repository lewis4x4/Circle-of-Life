import { describe, expect, it } from "vitest";

import { formatStaffRoleLabel } from "@/lib/staff/load-staff";

describe("formatStaffRoleLabel", () => {
  it("keeps job-title initials upper case (COL-659: /admin/staff showed Ceo, Coo, Cfo)", () => {
    expect(formatStaffRoleLabel("ceo")).toBe("CEO");
    expect(formatStaffRoleLabel("coo")).toBe("COO");
    expect(formatStaffRoleLabel("cfo")).toBe("CFO");
    expect(formatStaffRoleLabel("cna")).toBe("CNA");
    expect(formatStaffRoleLabel(" LPN ")).toBe("LPN");
  });

  it("title-cases word roles", () => {
    expect(formatStaffRoleLabel("resident_aide")).toBe("Resident Aide");
    expect(formatStaffRoleLabel("medication_tech")).toBe("Medication Tech");
    expect(formatStaffRoleLabel("hr_manager")).toBe("HR Manager");
  });
});
