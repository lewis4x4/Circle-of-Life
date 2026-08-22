import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminRevenuePage from "./page";

const mocks = vi.hoisted(() => ({
  selectedFacilityId: "11111111-1111-1111-1111-111111111111",
  gte: vi.fn(),
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
    gte: (column: string, value: string) => {
      mocks.gte(column, value);
      return query;
    },
    eq: () => query,
    limit: () => query,
    then: (resolve: (result: unknown) => unknown) =>
      Promise.resolve({
        data: [{ payment_date: "2026-08-20", amount: 125_00, deleted_at: null }],
        error: null,
      }).then(resolve),
  };

  return { from: () => query };
}

describe("AdminRevenuePage", () => {
  beforeEach(() => {
    mocks.gte.mockReset();
    mocks.client = makeClient();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("anchors the 14-month payment lookback to the Eastern calendar after 8pm ET", async () => {
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(eightOhFivePmEt);

    render(<AdminRevenuePage />);

    await waitFor(() => {
      expect(mocks.gte).toHaveBeenCalledWith("payment_date", "2025-06-20");
    });
    expect(mocks.gte).not.toHaveBeenCalledWith("payment_date", "2025-06-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("shows operators the inclusive Eastern lookback date", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-20T20:05:00-04:00"));

    render(<AdminRevenuePage />);

    expect(
      await screen.findByText("Includes payments dated on or after 2025-06-20 Eastern."),
    ).toBeInTheDocument();
  });
});
