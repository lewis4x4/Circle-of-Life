import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import TrialBalancePage from "./page";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

vi.mock("@/lib/finance/load-finance-context.server", () => ({
  loadFinanceRoleContextServer: vi.fn().mockResolvedValue({
    ok: false,
    error: "Finance access is unavailable.",
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

describe("TrialBalancePage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("defaults the as-of date to Eastern today after 8 p.m. ET", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-20T20:05:00-04:00"));

    const page = await TrialBalancePage();

    expect(page.props.initialDateTo).toBe("2026-08-20");
    expect(page.props.initialDateTo).not.toBe("2026-08-21");
  });

  it("keeps the month start aligned with the same Eastern date at month end", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-31T20:05:00-04:00"));

    const page = await TrialBalancePage();

    expect(page.props.initialDateFrom).toBe("2026-08-01");
    expect(page.props.initialDateTo).toBe("2026-08-31");
  });

  it("uses the shared facility wall-clock helper without a UTC date slice", () => {
    expect(pageSource).toContain("todayFacilityDateIso()");
    expect(pageSource).not.toContain("toISOString().slice(0, 10)");
  });
});
