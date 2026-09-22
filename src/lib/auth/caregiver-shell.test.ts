import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  caregiverShellAccessRedirect,
  isCaregiverReportPath,
  isCaregiverShellPath,
  isStaffRoleAllowedOnReportPath,
} from "./caregiver-shell";

function requestFor(pathname: string) {
  return new NextRequest(new URL(`https://haven.test${pathname}`));
}

function userWithRole(role: string) {
  return { app_metadata: { app_role: role } };
}

function redirectTarget(pathname: string, role: string | null): string | null {
  const response = caregiverShellAccessRedirect(requestFor(pathname), role === null ? null : userWithRole(role));
  if (!response) return null;
  return new URL(response.headers.get("location") ?? "", "https://haven.test").pathname;
}

describe("isCaregiverShellPath", () => {
  it("covers the report flow and its receipt revisit", () => {
    expect(isCaregiverShellPath("/caregiver/report")).toBe(true);
    expect(isCaregiverShellPath("/caregiver/report/3f2b0c1e-1111-4222-8333-444455556666")).toBe(true);
    expect(isCaregiverReportPath("/caregiver/report")).toBe(true);
    expect(isCaregiverReportPath("/caregiver/report/abc")).toBe(true);
    expect(isCaregiverReportPath("/caregiver/reports")).toBe(false);
    expect(isCaregiverReportPath("/caregiver")).toBe(false);
  });
});

describe("isStaffRoleAllowedOnReportPath", () => {
  it("allows the seven capture roles that migrations 401 and 468 let report a care event", () => {
    for (const role of ["owner", "org_admin", "facility_admin", "manager", "admin_assistant", "coordinator", "med_tech"]) {
      expect(isStaffRoleAllowedOnReportPath(role)).toBe(true);
    }
  });

  it("keeps family, onboarding, housekeeper, broker, cook, marketing, maintenance, retired, and unknown roles out", () => {
    for (const role of ["family", "onboarding", "housekeeper", "broker", "cook", "marketing", "dietary", "dietary_aide", "maintenance_role", "nurse", "caregiver", ""]) {
      expect(isStaffRoleAllowedOnReportPath(role)).toBe(false);
    }
  });
});

describe("caregiverShellAccessRedirect", () => {
  it("sends signed-out users to login with the next path", () => {
    const response = caregiverShellAccessRedirect(requestFor("/caregiver/report?resident=abc"), null);
    expect(response).not.toBeNull();
    const location = new URL(response?.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/caregiver/report?resident=abc");
  });

  it("lets med-techs (who absorbed the retired caregiver role) through everywhere in the shell", () => {
    for (const path of ["/caregiver", "/caregiver/report", "/caregiver/tasks", "/caregiver/rounds", "/caregiver/meds", "/tasks"]) {
      expect(redirectTarget(path, "med_tech")).toBeNull();
    }
  });

  it("turns a leftover caregiver token away", () => {
    expect(redirectTarget("/caregiver", "caregiver")).toBe("/login");
  });

  it("still redirects admin-eligible roles away from the caregiver home", () => {
    expect(redirectTarget("/caregiver", "facility_admin")).not.toBeNull();
    expect(redirectTarget("/caregiver", "facility_admin")).not.toBe("/caregiver");
    expect(redirectTarget("/caregiver/meds", "owner")).not.toBeNull();
  });

  it("allows admin-eligible and med tech roles on the report flow and its receipt", () => {
    expect(redirectTarget("/caregiver/report", "facility_admin")).toBeNull();
    expect(redirectTarget("/caregiver/report", "owner")).toBeNull();
    expect(redirectTarget("/caregiver/report", "admin_assistant")).toBeNull();
    expect(redirectTarget("/caregiver/report", "med_tech")).toBeNull();
    expect(redirectTarget("/caregiver/report/3f2b0c1e-1111-4222-8333-444455556666", "med_tech")).toBeNull();
  });

  it("keeps family out of the report flow", () => {
    expect(redirectTarget("/caregiver/report", "family")).toBe("/family");
  });

  it("keeps the housekeeper allow-list unchanged", () => {
    expect(redirectTarget("/caregiver/housekeeper", "housekeeper")).toBeNull();
    expect(redirectTarget("/caregiver/clock", "housekeeper")).toBeNull();
    expect(redirectTarget("/caregiver/report", "housekeeper")).not.toBeNull();
    expect(redirectTarget("/caregiver/meds", "housekeeper")).not.toBeNull();
  });

  it("sends unknown roles to login as forbidden, even on the report flow", () => {
    const response = caregiverShellAccessRedirect(requestFor("/caregiver/report"), userWithRole("onboarding"));
    const location = new URL(response?.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("reason")).toBe("forbidden");
  });
});
