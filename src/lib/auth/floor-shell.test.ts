import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ updateSession: vi.fn() }));
vi.mock("@/lib/supabase/middleware", () => ({ updateSession: state.updateSession }));

import { proxy } from "@/proxy";

import { floorShellAccessRedirect, isFloorSessionlessPath, isFloorShellPath } from "./floor-shell";

function requestFor(pathname: string) {
  return new NextRequest(new URL(`https://haven.test${pathname}`));
}

function userWithRole(role: string) {
  return { app_metadata: { app_role: role } };
}

function redirectTarget(pathname: string, role: string | null): string | null {
  const response = floorShellAccessRedirect(requestFor(pathname), role === null ? null : userWithRole(role));
  if (!response) return null;
  return new URL(response.headers.get("location") ?? "", "https://haven.test").pathname;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isFloorShellPath / isFloorSessionlessPath", () => {
  it("claims /floor and everything under it, and nothing that merely starts with the letters", () => {
    for (const path of ["/floor", "/floor/lock", "/floor/setup", "/floor/rounds", "/floor/check/abc"]) expect(isFloorShellPath(path)).toBe(true);
    for (const path of ["/floorplan", "/kiosk", "/caregiver", "/"]) expect(isFloorShellPath(path)).toBe(false);
  });

  it("treats only the lock and setup screens as session-less", () => {
    expect(isFloorSessionlessPath("/floor/lock")).toBe(true);
    expect(isFloorSessionlessPath("/floor/setup")).toBe(true);
    for (const path of ["/floor", "/floor/rounds", "/floor/locked", "/floor/report"]) expect(isFloorSessionlessPath(path)).toBe(false);
  });
});

describe("floorShellAccessRedirect", () => {
  it("never gates the lock and setup screens, with or without a session", () => {
    for (const path of ["/floor/lock", "/floor/setup"]) {
      expect(redirectTarget(path, null)).toBeNull();
      expect(redirectTarget(path, "family")).toBeNull();
    }
  });

  it("sends a tablet with no session to the lock screen, not to the password login", () => {
    const response = floorShellAccessRedirect(requestFor("/floor/residents/abc?tab=x"), null);
    const location = new URL(response?.headers.get("location") ?? "");
    expect(location.pathname).toBe("/floor/lock");
    expect(location.search).toBe("");
  });

  it("lets in every role a floor roster could list", () => {
    for (const role of ["med_tech", "facility_admin", "manager", "owner", "org_admin", "coordinator", "admin_assistant", "housekeeper", "cook", "maintenance_role", "recruiter"]) {
      expect(redirectTarget("/floor", role), role).toBeNull();
    }
  });

  it("sends family and broker home, and a retired or unknown role to the lock screen", () => {
    expect(redirectTarget("/floor", "family")).toBe("/family");
    expect(redirectTarget("/floor/rounds", "broker")).toBe("/admin/insurance");
    for (const role of ["caregiver", "nurse", "dietary", ""]) expect(redirectTarget("/floor", role), role).toBe("/floor/lock");
  });
});

describe("proxy on /floor", () => {
  it("answers no-store on a signed-in floor page and on its redirects", async () => {
    state.updateSession.mockResolvedValue({ response: NextResponse.next(), user: userWithRole("med_tech") });
    const allowed = await proxy(new NextRequest("http://localhost/floor"));
    expect(allowed.headers.get("location")).toBeNull();
    expect(allowed.headers.get("cache-control")).toBe("no-store");

    state.updateSession.mockResolvedValue({ response: NextResponse.next(), user: null });
    const locked = await proxy(new NextRequest("http://localhost/floor/rounds"));
    expect(locked.headers.get("location")).toBe("http://localhost/floor/lock");
    expect(locked.headers.get("cache-control")).toBe("no-store");
  });

  it("serves the lock screen without touching the session", async () => {
    const response = await proxy(new NextRequest("http://localhost/floor/lock"));
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.updateSession).not.toHaveBeenCalled();
  });
});
