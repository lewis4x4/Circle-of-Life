import fs from "node:fs";
import path from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminBillingRatesPage from "./page";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

const tables = vi.hoisted(() => ({ data: {} as Record<string, unknown[]> }));

vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: () => ({ selectedFacilityId: null }) }));
vi.mock("../billing-hub-nav", () => ({ BillingHubNav: () => null }));
vi.mock("../billing-invoice-ledger", () => ({
  billingCurrency: { format: (value: number) => `$${value.toLocaleString("en-US")}` },
}));
vi.mock("@/components/ui/motion-list", () => ({
  MotionList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MotionItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: string) => {
      const query = {
        select: () => query,
        is: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve({ data: tables.data[table] ?? [], error: null }).then(resolve),
      };
      return query;
    },
  }),
}));

const HW = "00000000-0000-0000-0002-000000000003";
const GC = "00000000-0000-0000-0002-000000000001";
const ORG = "00000000-0000-0000-0000-000000000001";
const schedule = (patch: Record<string, unknown>) => ({
  organization_id: ORG,
  status: "published",
  base_rate_private: 555000,
  base_rate_semi_private: 400000,
  care_surcharge_level_1: 0,
  care_surcharge_level_2: 0,
  care_surcharge_level_3: 0,
  community_fee: 0,
  deleted_at: null,
  ...patch,
});

describe("AdminBillingRatesPage (COL-666)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-23T12:00:00-04:00"));
    tables.data = {
      facilities: [
        { id: HW, name: "Homewood Lodge, ALF" },
        { id: GC, name: "Grande Cypress ALF" },
      ],
      billing_rate_rules: [
        {
          id: "rule",
          organization_id: ORG,
          facility_id: null,
          effective_from: "2026-01-01",
          rate_overlap_rule: "single_in_force",
          payer_split_is_concession: false,
          created_at: "2026-09-23T00:00:00Z",
        },
      ],
      rate_schedules: [
        schedule({ id: "oct", facility_id: HW, name: "2026 Homewood Posted Rates (Oct increase)", effective_date: "2026-10-01", end_date: null, base_rate_semi_private: 444000 }),
        schedule({ id: "may", facility_id: HW, name: "2026 Homewood Posted Rates", effective_date: "2026-05-01", end_date: "2026-09-30", status: "superseded", base_rate_semi_private: 440000 }),
        schedule({ id: "gc", facility_id: GC, name: "Standard Posted Rates 2026", effective_date: "2026-01-01", end_date: null }),
      ],
    };
  });

  afterEach(() => vi.useRealTimers());

  it("names each facility and the schedule that applies to it today", async () => {
    render(<AdminBillingRatesPage />);

    const homewood = await screen.findByRole("region", { name: "Homewood Lodge, ALF rate schedules" });
    expect(homewood).toHaveTextContent("In force today: 2026 Homewood Posted Rates — private $5,550, semi-private $4,400.");
    expect(homewood).toHaveTextContent("Next: 2026 Homewood Posted Rates (Oct increase) from Oct 1, 2026 — private $5,550, semi-private $4,440.");
    expect(homewood).toHaveTextContent("Rule: One schedule in force per facility at a time.");
    const cypress = screen.getByRole("region", { name: "Grande Cypress ALF rate schedules" });
    expect(cypress).toHaveTextContent("In force today: Standard Posted Rates 2026 — private $5,550, semi-private $4,000.");
    await waitFor(() => expect(screen.getByText("2 of 2 facilities with a schedule in force")).toBeInTheDocument());
    // The open-ended October row is upcoming, not "Current".
    expect(screen.getAllByText("Upcoming")).toHaveLength(1);
    expect(screen.getAllByText("Applies today")).toHaveLength(2);
  });

  it("never renders schedule notes, which carry developer and import text", () => {
    expect(pageSource).not.toMatch(/\bnotes\b/);
  });
});
