import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminNewRateSchedulePage from "./page";

const mocks = vi.hoisted(() => ({
  selectedFacilityId: "11111111-1111-1111-1111-111111111111" as string | null,
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/billing/rates/new",
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: mocks.selectedFacilityId }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ from: () => ({}) }),
}));
vi.mock("../../billing-hub-nav", () => ({ BillingHubNav: () => null }));

describe("AdminNewRateSchedulePage date defaults", () => {
  beforeEach(() => {
    mocks.selectedFacilityId = "11111111-1111-1111-1111-111111111111";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("defaults effective date to Eastern calendar today after 8pm ET, not UTC ISO slice", () => {
    /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers();
    vi.setSystemTime(eightOhFivePmEt);

    try {
      render(<AdminNewRateSchedulePage />);

      const effectiveDateInput = screen.getByLabelText(/^effective date \(eastern time\)$/i);
      expect(effectiveDateInput).toHaveValue("2026-08-20");
      expect(effectiveDateInput).not.toHaveValue("2026-08-21");
      expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
    } finally {
      vi.useRealTimers();
    }
  });
});
