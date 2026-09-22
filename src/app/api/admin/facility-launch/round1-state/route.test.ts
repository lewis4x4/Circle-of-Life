import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireActor: vi.fn() }));

vi.mock("@/lib/auth/current-api-actor", () => ({
  requireCurrentApiActor: mocks.requireActor,
}));

import { GET } from "./route";

describe("GET /api/admin/facility-launch/round1-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks the actor resolver for owner / org_admin only", async () => {
    mocks.requireActor.mockResolvedValue({
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    });

    await GET();

    expect(mocks.requireActor).toHaveBeenCalledWith(
      expect.objectContaining({ allowedRoles: ["owner", "org_admin"] }),
    );
  });

  it("returns the resolver's refusal and no state when signed out", async () => {
    mocks.requireActor.mockResolvedValue({
      response: Response.json({ error: "Not authenticated" }, { status: 401 }),
    });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Not authenticated" });
  });

  it("returns the resolver's refusal for a role without access", async () => {
    mocks.requireActor.mockResolvedValue({
      response: Response.json({ error: "Insufficient permissions" }, { status: 403 }),
    });

    const response = await GET();

    expect(response.status).toBe(403);
  });

  it("returns the Round 1 state, uncached, to an allowed actor", async () => {
    mocks.requireActor.mockResolvedValue({
      actor: { id: "user-1", organizationId: "org-1", appRole: "owner" },
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.facility?.id).toBeTruthy();
    expect(body.mvpData?.M3?.rooms).toHaveLength(20);
  });

  it("is no longer published under public/, where the CDN serves it without auth", () => {
    const publicDir = path.join(process.cwd(), "public/facility-launch-static");
    expect(existsSync(path.join(publicDir, "data/homewood-round1-state.json"))).toBe(false);
    expect(existsSync(path.join(publicDir, "data"))).toBe(false);
    expect(existsSync(path.join(publicDir, "index.html"))).toBe(false);
  });
});
