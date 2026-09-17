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

import { proxy } from "@/proxy";

const repoRoot = process.cwd();
const appDir = path.join(repoRoot, "src/app");
const readSource = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");

function pendingUser(pending: boolean) {
  return {
    app_metadata: {
      app_role: "caregiver",
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
    // A caregiver hitting /admin would normally be redirected to /caregiver. The
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
      user: { app_metadata: { app_role: "caregiver", organization_id: "org-1" } },
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
