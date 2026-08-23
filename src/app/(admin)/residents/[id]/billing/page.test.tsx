import fs from "node:fs";
import path from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ResidentBillingPage from "./page";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

type AnyRow = Record<string, unknown>;

const RESIDENT_ID = "a0000000-0000-4000-8000-0000000000a1";
const FACILITY_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "b0000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  selectedFacilityId: null as string | null,
  client: { from: () => ({}) as unknown },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: RESIDENT_ID }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/admin/residents/${RESIDENT_ID}/billing`,
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: mocks.selectedFacilityId }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mocks.client,
}));
vi.mock("../../../billing/billing-invoice-ledger", () => ({
  BillingInvoiceLedger: () => null,
  PayerTypeBadge: () => null,
  billingCurrency: { format: (n: number) => `$${n.toFixed(2)}` },
  mapDbPayerTypeToUi: (value: string) => value,
}));

function makeQueryChain(listData: AnyRow[], singleData: AnyRow | null = null) {
  const q: AnyRow = {
    select: () => q,
    is: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    lte: () => q,
    or: () => q,
    maybeSingle: async () => ({ data: singleData, error: null }),
    then: (resolve: (v: { data: AnyRow[]; error: null }) => unknown) =>
      Promise.resolve({ data: listData, error: null }).then(resolve),
  };
  return q;
}

function makeClient(resident: AnyRow) {
  return {
    from: (table: string) => {
      if (table === "residents") return makeQueryChain([], resident);
      if (table === "rate_schedules") {
        return makeQueryChain([
          {
            id: "c0000000-0000-4000-8000-0000000000c1",
            name: "Posted standard",
            effective_date: "2026-01-01",
            base_rate_private: 480000,
            base_rate_semi_private: 420000,
            care_surcharge_level_1: 0,
            care_surcharge_level_2: 0,
            care_surcharge_level_3: 0,
          },
        ]);
      }
      return makeQueryChain([]);
    },
  };
}

const anonymousResident: AnyRow = {
  id: RESIDENT_ID,
  facility_id: FACILITY_ID,
  organization_id: ORG_ID,
  first_name: "Resident",
  last_name: "A",
  acuity_level: "level_1",
  monthly_base_rate: null,
  monthly_care_surcharge: null,
  monthly_total_rate: null,
  rate_effective_date: null,
  deleted_at: null,
};

describe("ResidentBillingPage effective date", () => {
  beforeEach(() => {
    mocks.selectedFacilityId = null;
    mocks.client = makeClient(anonymousResident);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("defaults effective date to the Eastern calendar date at 8:05pm ET, not the next UTC date", async () => {
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(eightOhFivePmEt);

    try {
      render(<ResidentBillingPage />);

      const effectiveDateInput = await screen.findByLabelText(/^effective date \(et\)$/i);
      await waitFor(() => {
        expect(effectiveDateInput).toHaveValue("2026-08-20");
      });
      expect(effectiveDateInput).not.toHaveValue("2026-08-21");
      expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses todayFacilityDateIso for defaults and schedule fallback, not a UTC ISO slice", () => {
    expect(pageSource).toContain("todayFacilityDateIso()");
    expect(pageSource).toContain("Effective date (ET)");
    expect(pageSource).not.toMatch(
      /useState\(\s*\(\)\s*=>\s*new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
    );
    expect(pageSource).not.toMatch(/function todayIso\(/);
    expect(pageSource).not.toMatch(/toISOString\(\)\.slice\(0,\s*10\)/);
  });
});
