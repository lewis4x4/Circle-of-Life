import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { adminShellAccessRedirect } from "./admin-shell";
import { isAdminEligibleAppRole, isDietaryRole, isMedTechRole } from "./app-role";
import { dietaryShellAccessRedirect } from "./dietary-shell";
import { getDashboardRouteForRole, getShellForRole } from "./dashboard-routing";

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

describe("cook is dietary-equivalent", () => {
  it("is a dietary role", () => {
    expect(isDietaryRole("cook")).toBe(true);
    expect(isDietaryRole("dietary")).toBe(true);
    expect(isDietaryRole("dietary_aide")).toBe(true);
    expect(isDietaryRole("housekeeper")).toBe(false);
  });

  it("routes like dietary", () => {
    expect(getDashboardRouteForRole("cook")).toBe(getDashboardRouteForRole("dietary"));
    expect(getShellForRole("cook")).toBe(getShellForRole("dietary"));
    expect(isAdminEligibleAppRole("cook")).toBe(isAdminEligibleAppRole("dietary"));
  });

  it("opens the dietary command deck and is sent there from the admin dietary dashboard", () => {
    expect(dietaryShellAccessRedirect(new NextRequest("https://haven.test/dietary"), asUser("cook"))).toBeNull();
    expect(
      redirectPath(adminShellAccessRedirect(new NextRequest("https://haven.test/admin/dietary-dashboard"), asUser("cook"))),
    ).toBe("/dietary");
  });
});
