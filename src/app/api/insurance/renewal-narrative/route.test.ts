import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ requireCurrentApiActor: vi.fn() }));
vi.mock("@/lib/auth/current-api-actor", () => auth);
import { POST } from "./route";

beforeEach(() => vi.clearAllMocks());

it("directs an authorized legacy client to versioned packages without generating or writing", async () => {
  const write = vi.fn();
  auth.requireCurrentApiActor.mockResolvedValue({
    actor: { admin: { from: write } },
  });
  const result = await POST();
  expect(result.status).toBe(410);
  expect((await result.json()).replacement).toBe(
    "/admin/insurance/servicing?kind=renewal_package",
  );
  expect(write).not.toHaveBeenCalled();
});

it("preserves the authentication boundary and prevents caching", async () => {
  auth.requireCurrentApiActor.mockResolvedValue({
    response: Response.json({ error: "Not authenticated" }, { status: 401 }),
  });
  const result = await POST();
  expect(result.status).toBe(401);
  expect(result.headers.get("Cache-Control")).toContain("no-store");
});
