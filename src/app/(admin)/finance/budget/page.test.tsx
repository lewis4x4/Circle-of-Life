import fs from "node:fs";
import path from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BudgetPage from "./page";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

const mocks = vi.hoisted(() => ({
  organizationId: "b0000000-0000-4000-8000-000000000001" as string | null,
  appRole: "org_admin",
}));

function makeSupabaseClient() {
  const terminal = async () => ({ data: [], error: null });
  const builder = {
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    then: (
      onFulfilled: (value: Awaited<ReturnType<typeof terminal>>) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => terminal().then(onFulfilled, onRejected),
  };
  return {
    from: () => ({
      select: () => builder,
    }),
  };
}

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: mocks.organizationId,
    appRole: mocks.appRole,
  }),
}));

vi.mock("../finance-hub-nav", () => ({
  FinanceHubNav: () => null,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => makeSupabaseClient(),
}));

describe("BudgetPage Eastern period defaults", () => {
  beforeEach(() => {
    mocks.organizationId = "b0000000-0000-4000-8000-000000000001";
    mocks.appRole = "org_admin";
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("defaults the budget period to August 2026 Eastern after 8:05 p.m. ET on 2026-08-20", async () => {
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(eightOhFivePmEt);

    render(<BudgetPage />);

    const periodInput = await screen.findByLabelText(/^budget period \(et\)$/i);
    expect(periodInput).toHaveValue("2026-08-01");
    expect(periodInput).not.toHaveValue("2026-09-01");

    const dateToInput = screen.getByLabelText(/^actual through \(et\)$/i);
    expect(dateToInput).toHaveValue("2026-08-31");
    expect(dateToInput).not.toHaveValue("2026-09-30");
    expect(dateToInput).not.toHaveValue("2026-08-21");
  });

  it("keeps month-end aligned on the last Eastern day at 8:05 p.m. ET", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-31T20:05:00-04:00"));

    render(<BudgetPage />);

    await waitFor(() => {
      expect(screen.getByLabelText(/^budget period \(et\)$/i)).toHaveValue("2026-08-01");
    });
    expect(screen.getByLabelText(/^actual through \(et\)$/i)).toHaveValue("2026-08-31");
  });

  it("uses facility wall-clock helpers instead of UTC ISO date slices", () => {
    expect(pageSource).toContain("todayFacilityDateIso");
    expect(pageSource).toContain("addFacilityCalendarDays");
    expect(pageSource).not.toContain("toISOString().slice(0, 10)");
    expect(pageSource).not.toMatch(/new Date\(d\.getFullYear\(\), d\.getMonth\(\) \+ 1, 0\)/);
  });

  it("labels period controls with Eastern (ET)", () => {
    expect(pageSource).toContain("Budget period (ET)");
    expect(pageSource).toContain("Actual through (ET)");
  });
});
