import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { adminShellAccessRedirect } from "./admin-shell";
import { isAdminEligibleAppRole, isDietaryRole, isRecruiterAllowedAdminPath, isMedTechRole } from "./app-role";
import { caregiverShellAccessRedirect } from "./caregiver-shell";
import { dietaryShellAccessRedirect } from "./dietary-shell";
import { getDashboardRouteForRole, getRoleDashboardConfig, getShellForRole } from "./dashboard-routing";
import { medTechShellAccessRedirect } from "./med-tech-shell";

function redirectPath(response: Response | null): string | null {
  if (!response) return null;
  return new URL(response.headers.get("location") ?? "", "https://haven.test").pathname;
}

function asUser(role: string) {
  return { app_metadata: { app_role: role } };
}

describe("owner ruling 2026-09-22: nurse is folded into med_tech", () => {
  it("makes med_tech admin-eligible and drops the legacy nurse role", () => {
    expect(isAdminEligibleAppRole("med_tech")).toBe(true);
    expect(isAdminEligibleAppRole("nurse")).toBe(false);
    expect(isMedTechRole("med_tech")).toBe(true);
    expect(isMedTechRole("nurse")).toBe(false);
  });

  it("keeps the med-tech home on /med-tech", () => {
    expect(getDashboardRouteForRole("med_tech")).toBe("/med-tech");
  });

  it("lets a med_tech open admin pages without being bounced away", () => {
    for (const path of ["/admin/residents", "/admin/nurse-dashboard", "/admin/medication-errors", "/residents"]) {
      expect(redirectPath(adminShellAccessRedirect(new NextRequest(`https://haven.test${path}`), asUser("med_tech")))).toBeNull();
    }
    // The bare /admin landing still sends a med-tech to their home.
    expect(redirectPath(adminShellAccessRedirect(new NextRequest("https://haven.test/admin"), asUser("med_tech")))).toBe("/med-tech");
  });

  it("turns a leftover nurse token away from the admin shell", () => {
    const target = adminShellAccessRedirect(new NextRequest("https://haven.test/admin/residents"), asUser("nurse"));
    expect(redirectPath(target)).toBe("/login");
  });
});

describe("owner ruling 2026-09-22: caregiver is folded into med_tech", () => {
  it("lets a med_tech into the caregiver floor app and the med-tech app, landing on /med-tech", () => {
    for (const path of ["/caregiver", "/caregiver/tasks", "/caregiver/rounds", "/caregiver/report", "/tasks", "/resident/abc"]) {
      expect(caregiverShellAccessRedirect(new NextRequest(`https://haven.test${path}`), asUser("med_tech"))).toBeNull();
    }
    expect(medTechShellAccessRedirect(new NextRequest("https://haven.test/med-tech"), asUser("med_tech"))).toBeNull();
    expect(getDashboardRouteForRole("med_tech")).toBe("/med-tech");
    expect(getShellForRole("med_tech")).toBe("med-tech");
  });

  it("turns a leftover caregiver token away from every shell", () => {
    expect(redirectPath(caregiverShellAccessRedirect(new NextRequest("https://haven.test/caregiver"), asUser("caregiver")))).toBe("/login");
    expect(redirectPath(adminShellAccessRedirect(new NextRequest("https://haven.test/admin/residents"), asUser("caregiver")))).toBe("/login");
  });
});

describe("cook holds dietary + dietary_aide", () => {
  it("is a dietary role (legacy values still accepted)", () => {
    expect(isDietaryRole("cook")).toBe(true);
    expect(isDietaryRole("dietary")).toBe(true);
    expect(isDietaryRole("dietary_aide")).toBe(true);
    expect(isDietaryRole("housekeeper")).toBe(false);
  });

  it("lands on the dietary app with the Cook label", () => {
    expect(getDashboardRouteForRole("cook")).toBe("/dietary");
    expect(getShellForRole("cook")).toBe("dietary");
    expect(getRoleDashboardConfig("cook").roleLabel).toBe("Cook");
    // dietary was never admin-eligible at the proxy; cook follows it.
    expect(isAdminEligibleAppRole("cook")).toBe(false);
    expect(isAdminEligibleAppRole("dietary")).toBe(false);
  });

  it("opens the dietary command deck and is sent there from the admin dietary dashboard", () => {
    expect(dietaryShellAccessRedirect(new NextRequest("https://haven.test/dietary"), asUser("cook"))).toBeNull();
    expect(
      redirectPath(adminShellAccessRedirect(new NextRequest("https://haven.test/admin/dietary-dashboard"), asUser("cook"))),
    ).toBe("/dietary");
  });
});

describe("owner ruling 2026-09-22: recruiter is referrals, pipeline and reputation only", () => {
  it("is admin-eligible and lands on the referrals page", () => {
    expect(isAdminEligibleAppRole("recruiter")).toBe(true);
    expect(getDashboardRouteForRole("recruiter")).toBe("/admin/referrals");
    expect(getShellForRole("recruiter")).toBe("admin");
    const config = getRoleDashboardConfig("recruiter");
    expect(config.roleLabel).toBe("Recruiter");
    expect(config.visibleGroups).toEqual(["Pipeline"]);
    expect(config.visibleItemKeys).toEqual(["referrals"]);
    expect(redirectPath(adminShellAccessRedirect(new NextRequest("https://haven.test/admin"), asUser("recruiter")))).toBe(
      "/admin/referrals",
    );
  });

  it("opens referrals, pipeline referral aliases and reputation", () => {
    for (const path of [
      "/admin/referrals",
      "/admin/referrals/new",
      "/admin/referrals/abc",
      "/pipeline/referrals/new",
      "/pipeline/referrals-crm",
      "/reputation",
      "/admin/reputation/replies",
    ]) {
      expect(isRecruiterAllowedAdminPath(path)).toBe(true);
      expect(adminShellAccessRedirect(new NextRequest(`https://haven.test${path}`), asUser("recruiter"))).toBeNull();
    }
  });

  it("is refused from resident, clinical, billing, payroll, staff and settings pages", () => {
    for (const path of [
      "/admin/residents",
      "/residents/abc",
      "/admin/care-plans/reviews-due",
      "/admin/medications",
      "/admin/billing",
      "/billing",
      "/admin/payroll",
      "/admin/staff",
      "/admin/settings/users",
      "/admin/settings/notifications",
      "/admin/admissions",
      "/pipeline/recent-admissions",
      "/print/resident/abc",
      "/admin/executive",
    ]) {
      expect(redirectPath(adminShellAccessRedirect(new NextRequest(`https://haven.test${path}`), asUser("recruiter")))).toBe(
        "/admin/referrals",
      );
    }
  });

  it("is sent home from the floor, med-tech and dietary apps", () => {
    for (const [redirect, path] of [
      [caregiverShellAccessRedirect, "/caregiver"],
      [medTechShellAccessRedirect, "/med-tech"],
      [dietaryShellAccessRedirect, "/dietary"],
    ] as const) {
      expect(redirectPath(redirect(new NextRequest(`https://haven.test${path}`), asUser("recruiter")))).toBe("/admin/referrals");
    }
  });
});
