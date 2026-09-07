import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({ updateSession: vi.fn() }));
vi.mock("@/lib/supabase/middleware", () => ({ updateSession: state.updateSession }));

import { proxy } from "./proxy";

beforeEach(() => vi.clearAllMocks());

it("denies the admin shell when a stale owner JWT resolves to a current caregiver", async () => {
  state.updateSession.mockResolvedValue({
    response: NextResponse.next(),
    user: { app_metadata: { app_role: "caregiver", organization_id: "org-1", auth_claim_version: 9 } },
  });

  const response = await proxy(new NextRequest("http://localhost/admin/settings/users"));
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toBe("http://localhost/caregiver");
});

it("sends an inactive or revoked current actor to login", async () => {
  state.updateSession.mockResolvedValue({ response: NextResponse.next(), user: null });
  const response = await proxy(new NextRequest("http://localhost/admin"));
  expect(response.status).toBe(307);
  expect(response.headers.get("location")).toContain("/login");
});

it("returns a retryable outage response instead of treating unavailable authority as logout", async () => {
  state.updateSession.mockResolvedValue({ response: NextResponse.next(), user: null, unavailable: true });
  const response = await proxy(new NextRequest("http://localhost/admin"));
  expect(response.status).toBe(503);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("retry-after")).toBe("5");
});
