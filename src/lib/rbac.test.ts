import { describe, expect, it } from "vitest";

import { ACK_ROLES } from "@/lib/office/acknowledgments";
import { ALL_APP_ROLES, ADMIN_ELIGIBLE_ROLES, ROLE_LABELS, getAssignableRoles, getRoleTier, hasPermission } from "@/lib/rbac";
import { createUserSchema, updateUserSchema } from "@/lib/validation/user-management";

const validCreate = (app_role: string) => ({
  email: "new.user@example.test",
  full_name: "New User",
  app_role,
  facilities: [{ facility_id: "00000000-0000-4000-8000-000000000001", is_primary: true }],
});

const RETIRED_ROLES = ["nurse", "caregiver", "dietary", "dietary_aide"] as const;
const FEATURES = ["user_management", "billing", "clinical", "staff", "reports", "incidents", "care_plans"];

describe("app-role pickers (owner rulings 2026-09-22)", () => {
  it("offers exactly the current assignable roles", () => {
    expect([...ALL_APP_ROLES].sort()).toEqual(
      [
        "owner",
        "org_admin",
        "facility_admin",
        "manager",
        "admin_assistant",
        "coordinator",
        "med_tech",
        "cook",
        "housekeeper",
        "maintenance_role",
        "recruiter",
        "family",
        "broker",
      ].sort(),
    );
  });

  it("never offers a retired role and always offers cook, housekeeper, recruiter and med_tech", () => {
    const assignable = getAssignableRoles("owner");
    for (const retired of RETIRED_ROLES) {
      expect(ALL_APP_ROLES).not.toContain(retired);
      expect(assignable).not.toContain(retired);
    }
    expect(assignable).toEqual(expect.arrayContaining(["cook", "housekeeper", "recruiter", "med_tech"]));
    expect(ROLE_LABELS.cook).toBe("Cook");
    expect(ROLE_LABELS.housekeeper).toBe("Housekeeper");
    expect(ROLE_LABELS.recruiter).toBe("Recruiter");
    expect(ROLE_LABELS.med_tech).toBe("Med-Tech");
  });

  it("offers the current roles but no retired role in the acknowledgement role picker", () => {
    const ids = ACK_ROLES.map((role) => role.id);
    for (const retired of RETIRED_ROLES) expect(ids).not.toContain(retired);
    expect(ids).toEqual(expect.arrayContaining(["cook", "housekeeper", "recruiter", "med_tech"]));
  });

  it("rejects retired roles and accepts the current ones at the user-management API", () => {
    for (const retired of RETIRED_ROLES) {
      expect(createUserSchema.safeParse(validCreate(retired)).success).toBe(false);
      expect(updateUserSchema.safeParse({ app_role: retired }).success).toBe(false);
    }
    for (const role of ["cook", "housekeeper", "recruiter", "med_tech"]) {
      expect(createUserSchema.safeParse(validCreate(role)).success).toBe(true);
      expect(updateUserSchema.safeParse({ app_role: role }).success).toBe(true);
    }
  });
});

describe("med_tech holds nurse + caregiver; cook holds dietary + dietary_aide", () => {
  it("gives med_tech the nurse tier, admin-shell eligibility and clinical edit", () => {
    expect(getRoleTier("med_tech")).toBe(50);
    expect(getRoleTier("med_tech")).toBe(getRoleTier("nurse"));
    expect(ADMIN_ELIGIBLE_ROLES.has("med_tech")).toBe(true);
    for (const retired of RETIRED_ROLES) expect(ADMIN_ELIGIBLE_ROLES.has(retired)).toBe(false);
    expect(hasPermission("med_tech", "clinical", "edit")).toBe(true);
    expect(hasPermission("med_tech", "incidents", "edit")).toBe(true);
    for (const feature of FEATURES) expect(hasPermission("med_tech", feature, "view")).toBe(true);
  });

  it("gives cook the dietary tier, admin-shell eligibility and view-only features", () => {
    expect(getRoleTier("cook")).toBe(40);
    expect(getRoleTier("cook")).toBe(getRoleTier("dietary"));
    expect(ADMIN_ELIGIBLE_ROLES.has("cook")).toBe(true);
    for (const feature of FEATURES) {
      expect(hasPermission("cook", feature, "view")).toBe(true);
      expect(hasPermission("cook", feature, "edit")).toBe(false);
    }
  });

  it("gives recruiter tier 50, admin-shell eligibility and none of the feature permissions", () => {
    expect(getRoleTier("recruiter")).toBe(50);
    expect(ADMIN_ELIGIBLE_ROLES.has("recruiter")).toBe(true);
    for (const feature of FEATURES) expect(hasPermission("recruiter", feature, "view")).toBe(false);
  });
});
