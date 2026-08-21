import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatCents } from "@/lib/finance/format-cents";

import AdminOpeningBalancePage from "./page";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

type AnyRow = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  selectedFacilityId: "11111111-1111-1111-1111-111111111111" as string | null,
  rpc: vi.fn(),
  client: { from: () => ({}) as unknown, rpc: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/billing/invoices/opening-balance",
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: mocks.selectedFacilityId }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mocks.client,
}));
vi.mock("../../billing-hub-nav", () => ({ BillingHubNav: () => null }));

function makeClient(residentsList: AnyRow[]) {
  const q: AnyRow = {
    select: () => q,
    is: () => q,
    in: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    then: (resolve: (v: { data: AnyRow[]; error: null }) => unknown) =>
      Promise.resolve({ data: residentsList, error: null }).then(resolve),
  };
  return {
    from: (table: string) => {
      if (table === "residents") return q;
      return q;
    },
    rpc: mocks.rpc,
  };
}

const PINNED_FACILITY = "11111111-1111-1111-1111-111111111111";

describe("AdminOpeningBalancePage", () => {
  beforeEach(() => {
    mocks.selectedFacilityId = PINNED_FACILITY;
    mocks.rpc.mockResolvedValue({
      data: [{ invoice_id: "inv-1", inserted: true }],
      error: null,
    });
    mocks.client = makeClient([
      {
        id: "a0000000-0000-4000-8000-0000000000a1",
        first_name: "Alex",
        last_name: "Alpha",
        organization_id: "b0000000-0000-4000-8000-000000000001",
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("does not ship July 2026 launch copy or AR-report wording", () => {
    expect(pageSource).not.toMatch(/July\s+2026/i);
    expect(pageSource).not.toMatch(/AR report/i);
    expect(pageSource).not.toMatch(/AR import/i);
    expect(pageSource).not.toMatch(/Michelle/i);
    expect(pageSource).not.toContain("2026-07-01");
    expect(pageSource).not.toContain("2026-07-05");
  });

  it("defaults period start to Eastern calendar today and leaves notes empty", async () => {
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(eightOhFivePmEt);

    try {
      render(<AdminOpeningBalancePage />);

      const periodStartInput = await screen.findByLabelText(/^period start \(et\)$/i);
      expect(periodStartInput).toHaveValue("2026-08-20");
      expect(periodStartInput).not.toHaveValue("2026-08-21");

      const dueDateInput = screen.getByLabelText(/^due date \(et\)$/i);
      expect(dueDateInput).toHaveValue("");

      const notesInput = screen.getByLabelText(/^notes$/i);
      expect(notesInput).toHaveValue("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses todayFacilityDateIso for period start, not a UTC ISO slice", () => {
    expect(pageSource).toContain("todayFacilityDateIso()");
    expect(pageSource).not.toMatch(
      /useState\(\s*["']2026-07-/,
    );
    expect(pageSource).not.toMatch(
      /useState\(\s*\(\)\s*=>\s*new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
    );
  });

  it("shows generic opening-balance copy", async () => {
    render(<AdminOpeningBalancePage />);

    expect(screen.getByText("Opening balance")).toBeInTheDocument();
    expect(
      screen.getByText(/outstanding balance carried into haven for the selected facility/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/july 2026/i)).toBeNull();
    expect(screen.queryByText(/ar report/i)).toBeNull();

    expect(await screen.findByRole("option", { name: "Alpha, Alex" })).toBeInTheDocument();
  });

  it("formats success amount from integer cents via formatCents", () => {
    expect(pageSource).toContain("formatCents(cents)");
    expect(pageSource).not.toContain("billingCurrency");
    expect(formatCents(165_000)).toBe("$1,650.00");
  });
});
