import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminNewPaymentPage from "./page";

type AnyRow = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(""),
  selectedFacilityId: "11111111-1111-1111-1111-111111111111" as string | null,
  client: { from: () => ({}) as unknown },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/billing/payments/new",
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: mocks.selectedFacilityId }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mocks.client,
}));
vi.mock("../../billing-hub-nav", () => ({ BillingHubNav: () => null }));
vi.mock("../../billing-invoice-ledger", () => ({
  billingCurrency: { format: (n: number) => `$${n.toFixed(2)}` },
}));

function makeClient(opts: {
  residentsList: AnyRow[];
  residentSingle: AnyRow | null;
  invoicesList: AnyRow[];
}) {
  const builder = (listData: AnyRow[], singleData: AnyRow | null) => {
    const q: AnyRow = {
      select: () => q,
      is: () => q,
      in: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: singleData, error: null }),
      then: (resolve: (v: { data: AnyRow[]; error: null }) => unknown) =>
        Promise.resolve({ data: listData, error: null }).then(resolve),
    };
    return q;
  };
  return {
    from: (table: string) => {
      if (table === "residents") return builder(opts.residentsList, opts.residentSingle);
      if (table === "invoices") return builder(opts.invoicesList, null);
      return builder([], null);
    },
  };
}

describe("AdminNewPaymentPage prefill reconciliation", () => {
  beforeEach(() => {
    mocks.searchParams = new URLSearchParams({
      residentId: "r-pre",
      invoiceId: "inv-closed",
      amount: "125.00",
    });
    mocks.selectedFacilityId = "11111111-1111-1111-1111-111111111111";
    mocks.client = makeClient({
      // Active cohort for the pinned facility — does NOT include the deep-linked resident.
      residentsList: [
        { id: "r-a", first_name: "Amy", last_name: "Active", facility_id: "11111111-1111-1111-1111-111111111111" },
      ],
      // The deep-linked resident is fetched by id (any status / facility).
      residentSingle: { id: "r-pre", first_name: "Pat", last_name: "Prefill", facility_id: "22222222-2222-2222-2222-222222222222" },
      // The prefilled invoice (inv-closed) is NOT among the resident's open invoices.
      invoicesList: [
        { id: "inv-open", invoice_number: "INV-OPEN", balance_due: 5000, amount_paid: 0, status: "sent", period_start: "2026-05-01", period_end: "2026-05-31" },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("surfaces a deep-linked non-cohort resident and drops a closed prefilled invoice", async () => {
    const { container } = render(<AdminNewPaymentPage />);

    // A1: the prefilled resident (outside the active cohort) is merged in as an option.
    expect(await screen.findByRole("option", { name: "Prefill, Pat" })).toBeInTheDocument();

    const selects = () => Array.from(container.querySelectorAll("select"));
    await waitFor(() => expect((selects()[0] as HTMLSelectElement).value).toBe("r-pre"));

    // A2: the invoice select loads and the closed prefill is cleared (not selected).
    await waitFor(() => {
      const invoiceSelect = selects()[1] as HTMLSelectElement | undefined;
      expect(invoiceSelect).toBeDefined();
      expect(invoiceSelect!.value).toBe("");
    });
    expect(screen.getByRole("option", { name: /INV-OPEN/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /inv-closed/i })).toBeNull();
  });

  it("formats internal persist keys in the invoice picker", async () => {
    mocks.searchParams = new URLSearchParams({ residentId: "r-a" });
    mocks.client = makeClient({
      residentsList: [
        { id: "r-a", first_name: "Amy", last_name: "Active", facility_id: "11111111-1111-1111-1111-111111111111" },
      ],
      residentSingle: null,
      invoicesList: [
        {
          id: "b5000000-0000-0000-0000-0000000000a1",
          invoice_number: "00000000-2026-08-c0000000-0000-0000-0000-0000000000a1",
          invoice_date: "2026-08-01",
          balance_due: 0,
          amount_paid: 0,
          status: "sent",
          period_start: "2026-08-01",
          period_end: "2026-08-31",
        },
      ],
    });

    render(<AdminNewPaymentPage />);

    expect(await screen.findByRole("option", { name: /Invoice Aug 2026 · …00a1/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /00000000-2026-08/ })).toBeNull();
  });

  it("defaults payment date to Eastern calendar today after 8pm ET, not UTC ISO slice", () => {
    /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers();
    vi.setSystemTime(eightOhFivePmEt);

    try {
      mocks.searchParams = new URLSearchParams("");
      mocks.client = makeClient({ residentsList: [], residentSingle: null, invoicesList: [] });
      render(<AdminNewPaymentPage />);

      const paymentDateInput = screen.getByLabelText(/^payment date \(eastern time\)$/i);
      expect(paymentDateInput).toHaveValue("2026-08-20");
      expect(paymentDateInput).not.toHaveValue("2026-08-21");
      expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
    } finally {
      vi.useRealTimers();
    }
  });
});
