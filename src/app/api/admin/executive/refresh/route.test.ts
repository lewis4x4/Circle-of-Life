import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/finance/load-finance-context.server", () => ({
  loadFinanceRoleContextServer: vi.fn(),
}));

vi.mock("@/lib/finance/load-finance-context", () => ({
  canMutateFinance: vi.fn(),
}));

import { POST } from "./route";
import { canMutateFinance } from "@/lib/finance/load-finance-context";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";

const ROLE_CONTEXT = {
  ok: true as const,
  ctx: {
    appRole: "owner",
    organizationId: "00000000-0000-0000-0000-000000000123",
  },
};

const ORIGINAL_ENV = { ...process.env };

describe("/api/admin/executive/refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
    vi.mocked(loadFinanceRoleContextServer).mockResolvedValue(ROLE_CONTEXT as never);
    vi.mocked(canMutateFinance).mockReturnValue(true);
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.EXEC_KPI_SNAPSHOT_SECRET = "snapshot-secret";
    process.env.RESIDENT_SAFETY_SCORER_SECRET = "scorer-secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns only sanitized per-function failure details", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "raw edge body detail", stack: "sensitive" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockRejectedValueOnce(new Error("raw network error detail"));

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST();
    const payload = await response.json();

    expect(response.status).toBe(502);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("Executive refresh did not complete successfully.");
    expect(payload.snapshot).toEqual({
      name: "exec-kpi-snapshot",
      ok: false,
      status: 500,
    });
    expect(payload.scorer).toEqual({
      name: "resident-safety-scorer",
      ok: false,
      status: 0,
    });

    const payloadJson = JSON.stringify(payload);
    expect(payloadJson).not.toContain("raw edge body detail");
    expect(payloadJson).not.toContain("raw network error detail");
    expect(payloadJson).not.toContain("stack");
    expect(consoleError).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("raw edge body detail");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("raw network error detail");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("stack");
  });
});
