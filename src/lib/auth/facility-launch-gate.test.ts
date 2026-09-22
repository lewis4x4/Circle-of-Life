/**
 * /facility-launch shows internal Homewood launch material (legal entities, gates,
 * decisions). It was served to anyone, logged out included; it now sits behind the
 * admin-shell session and the owner / org_admin rule.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({ updateSession: vi.fn() }));
vi.mock("@/lib/supabase/middleware", () => ({ updateSession: state.updateSession }));

import { config, proxy } from "@/proxy";
import { isAdminShellPath } from "@/lib/auth/admin-shell";

function signedIn(appRole: string) {
  return { app_metadata: { app_role: appRole, organization_id: "org-1" } };
}

function session(user: ReturnType<typeof signedIn> | null) {
  state.updateSession.mockResolvedValue({ response: NextResponse.next(), user });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("facility launch gate", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);

  it("routes the page through the proxy but leaves its static assets alone", () => {
    expect(isAdminShellPath("/facility-launch")).toBe(true);
    expect(matcher.test("/facility-launch")).toBe(true);
    expect(isAdminShellPath("/facility-launch-static/dist/app.bundle.js")).toBe(false);
    expect(matcher.test("/facility-launch-static/dist/app.bundle.js")).toBe(false);
  });

  it("sends a signed-out visitor to login", async () => {
    session(null);
    const response = await proxy(new NextRequest("http://localhost/facility-launch"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/facility-launch");
  });

  it.each(["facility_admin", "manager", "nurse", "coordinator"])(
    "sends a signed-in %s to their home instead",
    async (role) => {
      session(signedIn(role));
      const response = await proxy(new NextRequest("http://localhost/facility-launch"));
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location") ?? "").pathname).not.toBe("/facility-launch");
    },
  );

  it.each(["owner", "org_admin"])("lets a signed-in %s through", async (role) => {
    session(signedIn(role));
    const response = await proxy(new NextRequest("http://localhost/facility-launch"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });
});
