/**
 * Forced password change must be enforced on every route group and on the API —
 * not on whichever surfaces someone remembered. COL-362.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({ updateSession: vi.fn() }));
vi.mock("@/lib/supabase/middleware", () => ({ updateSession: state.updateSession }));

import { config, proxy } from "@/proxy";
import { isAdminShellPath } from "@/lib/auth/admin-shell";
import { isCaregiverShellPath } from "@/lib/auth/caregiver-shell";
import { isDietaryShellPath } from "@/lib/auth/dietary-shell";
import { isFamilyShellPath } from "@/lib/auth/family-shell";
import { isMedTechShellPath } from "@/lib/auth/med-tech-shell";
import { isOnboardingShellPath } from "@/lib/auth/onboarding-shell";

const repoRoot = process.cwd();
const appDir = path.join(repoRoot, "src/app");
const readSource = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

function pendingUser(pending: boolean) {
  return {
    app_metadata: {
      app_role: "med_tech",
      organization_id: "org-1",
      auth_claim_version: 9,
      must_change_password: pending,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.updateSession.mockResolvedValue({
    response: NextResponse.next(),
    user: pendingUser(true),
  });
});

// ── Route-group coverage ──────────────────────────────────────────

describe("every authenticated route group is gated", () => {
  /** Route-group directories: `src/app/(name)`. */
  const routeGroups = readdirSync(appDir).filter(
    (entry) =>
      entry.startsWith("(") &&
      entry.endsWith(")") &&
      statSync(path.join(appDir, entry)).isDirectory(),
  );

  it("finds the route groups this repo actually has", () => {
    // Fails loudly if a group is added or removed, so the list below cannot drift.
    expect(routeGroups.sort()).toEqual([
      "(admin)",
      "(caregiver)",
      "(dietary)",
      "(family)",
      "(med-tech)",
      "(onboarding)",
      "(print)",
    ]);
  });

  it.each(routeGroups)("%s mounts AppRuntimeProviders, which carries the gate", (group) => {
    const layout = readSource(path.join("src/app", group, "layout.tsx"));
    expect(layout).toContain("AppRuntimeProviders");
  });

  it("keeps the gate inside AppRuntimeProviders", () => {
    const providers = readSource("src/components/layout/AppRuntimeProviders.tsx");
    expect(providers).toContain("MustChangePasswordGate");
  });

  it("gates the authenticated layouts that sit outside a route group", () => {
    for (const layout of [
      "src/app/clinical/layout.tsx",
      "src/app/pipeline/discharge-management/layout.tsx",
      "src/app/change-password/layout.tsx",
    ]) {
      expect(readSource(layout), layout).toContain("AppRuntimeProviders");
    }
  });

  it("mounts the gate exactly once, so there is a single place to reason about", () => {
    // Two mounts would both work, but the second is where drift starts.
    const mounts = [
      "src/components/layout/AppRuntimeProviders.tsx",
      "src/contexts/haven-auth-context.tsx",
    ].filter((file) => readSource(file).includes("<MustChangePasswordGate"));

    expect(mounts).toEqual(["src/components/layout/AppRuntimeProviders.tsx"]);
  });

  it("does not depend on HavenAuthProvider being in scope", () => {
    // The old gate read the Haven auth context, whose hook throws outside its
    // provider — which is why it could not be mounted in the four unguarded groups.
    const gate = readSource("src/components/auth/MustChangePasswordGate.tsx");
    expect(gate).not.toMatch(/from "@\/contexts\/haven-auth-context"/);
  });
});

// ── Server-side enforcement, one shell path per group ──────────────

describe("proxy redirects a pending user from every shell", () => {
  const shellPaths = [
    "/admin",
    "/admin/settings/users",
    "/clinical",
    "/billing",
    "/residents",
    "/executive",
    "/caregiver",
    "/dietary",
    "/med-tech",
    "/family",
    "/onboarding",
    "/meds",
    "/tasks",
    "/schedules",
    "/reports",
  ];

  it.each(shellPaths)("%s redirects to /change-password", async (pathname) => {
    const response = await proxy(new NextRequest(`http://localhost${pathname}`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/change-password");
  });

  it("drops the query string so a next= param cannot bounce the user back", async () => {
    const response = await proxy(
      new NextRequest("http://localhost/admin/settings/users?next=/admin"),
    );
    expect(response.headers.get("location")).toBe("http://localhost/change-password");
  });

  it("outranks the shell's own role routing", async () => {
    // A med-tech hitting /admin would normally be redirected to /med-tech. The
    // password change comes first, so they cannot be routed into a shell instead.
    const response = await proxy(new NextRequest("http://localhost/admin"));
    expect(response.headers.get("location")).toBe("http://localhost/change-password");
  });

  it("lets a user with no pending change through", async () => {
    state.updateSession.mockResolvedValue({
      response: NextResponse.next(),
      user: pendingUser(false),
    });
    const response = await proxy(new NextRequest("http://localhost/caregiver"));
    expect(response.status).not.toBe(307);
  });

  it("treats a missing claim as no pending change", async () => {
    state.updateSession.mockResolvedValue({
      response: NextResponse.next(),
      user: { app_metadata: { app_role: "med_tech", organization_id: "org-1" } },
    });
    const response = await proxy(new NextRequest("http://localhost/caregiver"));
    expect(response.status).not.toBe(307);
  });

  it("still sends an unauthenticated request to login", async () => {
    state.updateSession.mockResolvedValue({ response: NextResponse.next(), user: null });
    const response = await proxy(new NextRequest("http://localhost/admin"));
    expect(response.headers.get("location")).toContain("/login");
  });
});

// ── Matcher coverage ──────────────────────────────────────────────

describe("the proxy matcher reaches every path the shells claim", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  /**
   * A shell predicate that answers true for a path the matcher never routes to the
   * proxy is a silent hole: the code reads as guarded and is not. `/print` was exactly
   * this — `isAdminShellPath` claimed it, the matcher did not list it, so print sheets
   * ran with no session refresh, no role gate, and no password-change redirect.
   */
  const shellPaths = [
    "/admin",
    "/admin/settings/users",
    "/print",
    "/print/resident-face-sheet",
    "/facility-launch",
    "/clinical",
    "/billing",
    "/finance",
    "/pipeline",
    "/risk",
    "/insurance",
    "/vendors",
    "/residents",
    "/staff",
    "/staffing",
    "/incidents",
    "/schedules",
    "/time-records",
    "/payroll",
    "/certifications",
    "/training",
    "/transportation",
    "/reputation",
    "/assessments",
    "/care-plans",
    "/family-messages",
    "/executive",
    "/search",
    "/reports",
    "/caregiver",
    "/dietary",
    "/med-tech",
    "/family",
    "/onboarding",
  ];

  it.each(shellPaths)("%s is claimed by a shell predicate", (pathname) => {
    const claimed =
      isAdminShellPath(pathname) ||
      isCaregiverShellPath(pathname) ||
      isDietaryShellPath(pathname) ||
      isMedTechShellPath(pathname) ||
      isFamilyShellPath(pathname) ||
      isOnboardingShellPath(pathname);
    expect(claimed).toBe(true);
  });

  it.each(shellPaths)("%s is routed to the proxy by config.matcher", (pathname) => {
    expect(matcher.test(pathname)).toBe(true);
  });

  it("still keeps /api and static assets out of the proxy", () => {
    for (const pathname of [
      "/api/admin/users",
      "/api/account/change-password",
      "/login",
      "/",
      "/about",
      "/admin/app.css",
      "/admin/chunk.js",
    ]) {
      expect(matcher.test(pathname), pathname).toBe(false);
    }
  });

  it("redirects a pending user away from a print sheet", async () => {
    const response = await proxy(new NextRequest("http://localhost/print/resident-face-sheet"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/change-password");
  });
});
