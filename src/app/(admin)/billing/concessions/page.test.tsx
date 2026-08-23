import fs from "node:fs";
import path from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BillingConcessionsPage from "./page";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

const mocks = vi.hoisted(() => ({
  selectedFacilityId: "11111111-1111-1111-1111-111111111111" as string | null,
  lteEffectiveDate: vi.fn(),
  client: { from: () => ({}) as unknown },
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: mocks.selectedFacilityId }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mocks.client,
}));
vi.mock("../billing-hub-nav", () => ({ BillingHubNav: () => null }));
vi.mock("../billing-invoice-ledger", () => ({
  billingCurrency: { format: (value: number) => `$${value.toFixed(2)}` },
}));
vi.mock("@/components/ui/motion-list", () => ({
  MotionList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MotionItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/kinetic-grid", () => ({
  KineticGrid: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/v2-card", () => ({
  V2Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/monolithic-watermark", () => ({
  MonolithicWatermark: () => null,
}));

function makeClient() {
  const query = {
    select: () => query,
    is: () => query,
    eq: () => query,
    or: () => query,
    order: () => query,
    limit: () => query,
    lte: (column: string, value: string) => {
      if (column === "effective_date") {
        mocks.lteEffectiveDate(value);
      }
      return query;
    },
    then: (resolve: (result: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve),
  };

  return { from: () => query };
}

describe("BillingConcessionsPage", () => {
  beforeEach(() => {
    mocks.selectedFacilityId = "11111111-1111-1111-1111-111111111111";
    mocks.lteEffectiveDate.mockReset();
    mocks.client = makeClient();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("anchors rate schedule and agreement windows to the Eastern calendar after 8pm ET", async () => {
    /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(eightOhFivePmEt);

    render(<BillingConcessionsPage />);

    await waitFor(() => {
      expect(mocks.lteEffectiveDate).toHaveBeenCalledWith("2026-08-20");
    });
    expect(mocks.lteEffectiveDate).not.toHaveBeenCalledWith("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("shows operators the Eastern as-of date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-20T20:05:00-04:00"));

    render(<BillingConcessionsPage />);

    expect(
      await screen.findByText("Rate schedules and agreements as of 2026-08-20 Eastern."),
    ).toBeInTheDocument();
  });

  it("uses todayFacilityDateIso for schedule and agreement windows, not a UTC ISO slice", () => {
    expect(pageSource).toContain("todayFacilityDateIso()");
    expect(pageSource).toContain("as of {asOfDate} Eastern");
    expect(pageSource).not.toMatch(
      /targetDate\s*=\s*new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
    );
  });
});
