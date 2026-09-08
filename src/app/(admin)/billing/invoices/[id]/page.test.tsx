import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminInvoiceDetailPage from "../../../admin/billing/invoices/[id]/page";

const mocks = vi.hoisted(() => ({
  invoiceId: "b5000000-0000-0000-0000-0000000000a1",
  facilityId: "11111111-1111-1111-1111-111111111111",
  residentId: "c0000000-0000-0000-0000-000000000001",
  params: { id: "b5000000-0000-0000-0000-0000000000a1" },
  selectedFacilityId: "11111111-1111-1111-1111-111111111111" as string | null,
  appRole: "admin" as string,
  canPost: false,
  existingJournal: null as { id: string } | null,
  post: vi.fn(),
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
vi.mock("@/lib/finance/post-to-gl", () => ({ postInvoiceToGl: mocks.post }));
vi.mock("@/lib/finance/load-finance-context", () => ({ canMutateFinance: () => mocks.canPost }));
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
    total: 1000,
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
      if (table === "journal_entries") return builder(mocks.existingJournal);
      return builder(null);
    },
  };
}

describe("AdminInvoiceDetailPage invoice title", () => {
  beforeEach(() => {
    mocks.canPost = false;
    mocks.existingJournal = null;
    mocks.params = { id: mocks.invoiceId };
    mocks.selectedFacilityId = mocks.facilityId;
    mocks.client = makeClient();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires a verified receipt even when a source journal header already exists", async () => {
    mocks.canPost = true;
    mocks.existingJournal = { id: "existing-draft" };
    mocks.post.mockResolvedValue({ ok: false, error: "Draft journal existing-draft requires review" });
    render(<AdminInvoiceDetailPage />);
    expect(await screen.findByRole("link", { name: "Review existing journal entry" })).toHaveAttribute("href", "/admin/finance/journal-entries/existing-draft");
    expect(screen.queryByText(/Previously posted to GL/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Post to GL" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Draft journal existing-draft requires review");
    expect(screen.queryByText(/Posted to GL/)).toBeNull();
    mocks.post.mockResolvedValue({ ok: true, journalEntryId: "existing-draft", alreadyPosted: false });
    fireEvent.click(screen.getByRole("button", { name: "Post to GL" }));
    expect(await screen.findByText("Commit successful. Posted to GL.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View journal entry" })).toHaveAttribute("href", "/admin/finance/journal-entries/existing-draft");
  });

  it("formats internal persist keys in the detail header", async () => {
    render(<AdminInvoiceDetailPage />);

    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Invoice Aug 2026 · …00a1");
    expect(screen.queryByText(/00000000-2026-08/)).toBeNull();
  });
});
