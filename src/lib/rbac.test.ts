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

describe("app-role pickers (owner ruling 2026-09-22)", () => {
  it("never offers nurse and always offers cook and housekeeper", () => {
    expect(ALL_APP_ROLES).not.toContain("nurse");
    expect(ALL_APP_ROLES).toContain("cook");
    expect(ALL_APP_ROLES).toContain("housekeeper");
    const assignable = getAssignableRoles("owner");
    expect(assignable).not.toContain("nurse");
    expect(assignable).toEqual(expect.arrayContaining(["cook", "housekeeper", "med_tech"]));
    expect(ROLE_LABELS.cook).toBe("Cook");
    expect(ROLE_LABELS.housekeeper).toBe("Housekeeper");
  });

  it("offers cook and housekeeper but not nurse in the acknowledgement role picker", () => {
    const ids = ACK_ROLES.map((role) => role.id);
    expect(ids).not.toContain("nurse");
    expect(ids).toEqual(expect.arrayContaining(["cook", "housekeeper", "med_tech"]));
  });

  it("rejects nurse and accepts cook and housekeeper at the user-management API", () => {
    expect(createUserSchema.safeParse(validCreate("nurse")).success).toBe(false);
    expect(createUserSchema.safeParse(validCreate("cook")).success).toBe(true);
    expect(createUserSchema.safeParse(validCreate("housekeeper")).success).toBe(true);
    expect(updateUserSchema.safeParse({ app_role: "nurse" }).success).toBe(false);
    expect(updateUserSchema.safeParse({ app_role: "cook" }).success).toBe(true);
  });
});

describe("med_tech inherits nurse; cook mirrors dietary", () => {
  it("gives med_tech the nurse tier and admin-shell eligibility", () => {
    expect(getRoleTier("med_tech")).toBe(getRoleTier("nurse"));
    expect(ADMIN_ELIGIBLE_ROLES.has("med_tech")).toBe(true);
    expect(ADMIN_ELIGIBLE_ROLES.has("nurse")).toBe(false);
    expect(hasPermission("med_tech", "clinical", "edit")).toBe(true);
    expect(hasPermission("med_tech", "incidents", "edit")).toBe(true);
  });

  it("gives cook exactly what dietary has", () => {
    expect(getRoleTier("cook")).toBe(getRoleTier("dietary"));
    expect(ADMIN_ELIGIBLE_ROLES.has("cook")).toBe(ADMIN_ELIGIBLE_ROLES.has("dietary"));
    for (const feature of ["user_management", "billing", "clinical", "staff", "reports", "incidents", "care_plans"]) {
      for (const level of ["view", "edit"] as const) {
        expect(hasPermission("cook", feature, level)).toBe(hasPermission("dietary", feature, level));
      }
    }
  });
});
