import fs from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import VendorPaymentsPage from "./page";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

vi.mock("../vendor-hub-nav", () => ({ VendorHubNav: () => null }));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: "11111111-1111-1111-1111-111111111111",
    appRole: "owner",
    loading: false,
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: { rows: [], entities: [], vendors: [], facilities: [] },
    isPending: false,
    error: null,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        order: () => q,
        limit: () => q,
        insert: async () => ({ error: null }),
      };
      return q;
    },
  }),
}));

describe("VendorPaymentsPage payment date", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("defaults payDate to Eastern calendar today after 8pm ET, not UTC ISO slice", () => {
    /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers();
    vi.setSystemTime(eightOhFivePmEt);

    render(<VendorPaymentsPage />);

    const paymentDateInput = screen.getByLabelText(/^payment date \(eastern time\)$/i);
    expect(paymentDateInput).toHaveValue("2026-08-20");
    expect(paymentDateInput).not.toHaveValue("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("uses todayFacilityDateIso and stamps the payment date as Eastern (ET)", () => {
    expect(pageSource).toContain("todayFacilityDateIso()");
    expect(pageSource).toContain("Payment date (ET)");
    expect(pageSource).toContain("Payment date (Eastern Time)");
    expect(pageSource).not.toMatch(
      /useState\(\s*\(\)\s*=>\s*new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
    );
  });
});
