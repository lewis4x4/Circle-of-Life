import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/current-api-actor", () => ({
  revalidateCurrentApiActor: vi.fn(),
}));
import { insuranceError, InsuranceRpcError } from "./workspace-server";

describe("insurance authorization error contract", () => {
  it.each([
    ["28000", "Authentication required"],
    ["PGRST", '{"code":"HAVEN_AUTHORIZATION_STALE","message":"refresh"}'],
    ["PGRST301", "JWT expired"],
  ])(
    "returns reauthentication for %s without confusing it with a stale draft",
    async (code, message) => {
      const response = insuranceError(new InsuranceRpcError(message, code));
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toContain("no-store");
      expect((await response.json()).error).toMatch(/Sign in again/);
    },
  );

  it("keeps a stale draft conflict distinct from a forbidden action", () => {
    expect(
      insuranceError(new InsuranceRpcError("Stale draft revision", "40001"))
        .status,
    ).toBe(409);
    expect(
      insuranceError(
        new InsuranceRpcError("Insurance access forbidden", "42501"),
      ).status,
    ).toBe(403);
  });
});
