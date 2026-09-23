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

function makeTableClient(tables: Record<string, unknown[]>) {
  return {
    from: (table: string) => {
      const query = {
        select: () => query,
        is: () => query,
        eq: () => query,
        or: () => query,
        order: () => query,
        limit: () => query,
        lte: () => query,
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve),
      };
      return query;
    },
  };
}

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

  it("lists a Medicaid split as a payer split, not a concession against the private rate (COL-666)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T12:00:00-04:00"));
    const org = "00000000-0000-0000-0000-000000000001";
    mocks.client = makeTableClient({
      residents: [
        { id: "r-split", first_name: "Ann", last_name: "Split", acuity_level: null, monthly_total_rate: 243700, rate_effective_date: null, bed_by_id: { rooms: { room_type: "semi_private" } } },
        { id: "r-private", first_name: "Bo", last_name: "Private", acuity_level: null, monthly_total_rate: 318300, rate_effective_date: null, bed_by_id: { rooms: { room_type: "semi_private" } } },
      ],
      rate_schedules: [
        { id: "oct", organization_id: org, status: "published", effective_date: "2026-10-01", end_date: null, base_rate_private: 555000, base_rate_semi_private: 444000, care_surcharge_level_1: 0, care_surcharge_level_2: 0, care_surcharge_level_3: 0 },
        { id: "may", organization_id: org, status: "superseded", effective_date: "2026-05-01", end_date: "2026-09-30", base_rate_private: 555000, base_rate_semi_private: 440000, care_surcharge_level_1: 0, care_surcharge_level_2: 0, care_surcharge_level_3: 0 },
      ],
      resident_payers: [
        { resident_id: "r-split", payer_type: "medicaid_oss", payer_name: "UHC", payer_share_type: "fixed_amount", payer_fixed_amount: 243700, medicaid_rate: 160000, medicaid_patient_responsibility: 83700, effective_date: "2026-01-01", end_date: null },
        { resident_id: "r-private", payer_type: "private_pay", payer_name: null, payer_share_type: "fixed_amount", payer_fixed_amount: 318300, medicaid_rate: null, medicaid_patient_responsibility: null, effective_date: "2026-01-01", end_date: null },
      ],
      billing_rate_rules: [
        { id: "rule", organization_id: org, facility_id: null, effective_from: "2026-01-01", rate_overlap_rule: "single_in_force", payer_split_is_concession: false, created_at: "2026-09-23T00:00:00Z" },
      ],
    });

    render(<BillingConcessionsPage />);

    expect(await screen.findByText("Payer split")).toBeInTheDocument();
    expect(screen.getByText("Medicaid (UHC): $1600.00")).toBeInTheDocument();
    expect(screen.getByText("Resident share: $837.00")).toBeInTheDocument();
    expect(screen.getByText("Not a concession")).toBeInTheDocument();
    // The private-pay companion resident is measured against May's $4,400 companion rate, not $5,550.
    expect(screen.getAllByText("$1217.00").length).toBeGreaterThan(0);
    expect(screen.getByText("2 residents active today with a monthly rate on file.")).toBeInTheDocument();
    expect(screen.getByText(/1 resident has a payer split \(\$2437\.00 in monthly terms\) and is not counted as concessions\./)).toBeInTheDocument();
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
