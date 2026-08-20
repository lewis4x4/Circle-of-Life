import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminInvoiceDetailPage from "./page";

const mocks = vi.hoisted(() => ({
  invoiceId: "b5000000-0000-0000-0000-0000000000a1",
  facilityId: "11111111-1111-1111-1111-111111111111",
  residentId: "c0000000-0000-0000-0000-000000000001",
  params: { id: "b5000000-0000-0000-0000-0000000000a1" },
  selectedFacilityId: "11111111-1111-1111-1111-111111111111" as string | null,
  appRole: "admin" as string,
  client: { from: () => ({}) as unknown },
}));

vi.mock("next/navigation", () => ({
  useParams: () => mocks.params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => `/admin/billing/invoices/${mocks.invoiceId}`,
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: mocks.selectedFacilityId }),
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ appRole: mocks.appRole }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mocks.client,
}));
vi.mock("../../billing-hub-nav", () => ({ BillingHubNav: () => null }));
vi.mock("../../billing-invoice-ledger", () => ({
  billingCurrency: { format: (n: number) => `$${n.toFixed(2)}` },
  InvoiceStatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
  PayerTypeBadge: ({ payerType }: { payerType: string }) => <span>{payerType}</span>,
  mapDbInvoiceStatusToUi: (s: string) => s,
  mapDbPayerTypeToUi: () => "private_pay",
}));
vi.mock("@/lib/finance/post-to-gl", () => ({ postInvoiceToGl: vi.fn() }));
vi.mock("@/lib/finance/load-finance-context", () => ({ canMutateFinance: () => false }));
vi.mock("@/design-system/components/record-detail", () => ({
  RecordDetailHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  RecordDetailSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function makeClient() {
  const invoice = {
    id: mocks.invoiceId,
    resident_id: mocks.residentId,
    facility_id: mocks.facilityId,
    invoice_number: "00000000-2026-08-c0000000-0000-0000-0000-0000000000a1",
    invoice_date: "2026-08-01",
    due_date: "2026-08-15",
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    status: "sent",
    subtotal: 0,
    adjustments: 0,
    tax: 0,
    total: 0,
    amount_paid: 0,
    balance_due: 0,
    payer_type: "private_pay",
    payer_name: null,
    notes: null,
    deleted_at: null,
  };

  const builder = (single: unknown, list: unknown[] = []) => {
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      is: () => q,
      order: () => q,
      maybeSingle: async () => ({ data: single, error: null }),
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        Promise.resolve({ data: list, error: null }).then(resolve),
    };
    return q;
  };

  return {
    from: (table: string) => {
      if (table === "invoices") return builder(invoice);
      if (table === "invoice_line_items") return builder(null, []);
      if (table === "residents") return builder({ id: mocks.residentId, first_name: "A", last_name: "B" });
      if (table === "journal_entries") return builder(null);
      return builder(null);
    },
  };
}

describe("AdminInvoiceDetailPage invoice title", () => {
  beforeEach(() => {
    mocks.params = { id: mocks.invoiceId };
    mocks.selectedFacilityId = mocks.facilityId;
    mocks.client = makeClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("formats internal persist keys in the detail header", async () => {
    render(<AdminInvoiceDetailPage />);

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Invoice Aug 2026 · …00a1");
    expect(screen.queryByText(/00000000-2026-08/)).toBeNull();
  });
});
