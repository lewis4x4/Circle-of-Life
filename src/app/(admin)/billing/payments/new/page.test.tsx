import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminNewPaymentPage from "./page";

type AnyRow = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(""),
  selectedFacilityId: "11111111-1111-1111-1111-111111111111" as string | null,
  rpc: vi.fn(),
  actor: "actor",
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
  invoiceSingle?: AnyRow | null;
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
    auth: { getSession: async () => ({ data: { session: { user: { id: mocks.actor }, access_token: `x.${btoa(JSON.stringify({session_id:"session"}))}.x` } }, error: null }) },
    rpc: mocks.rpc,
    from: (table: string) => {
      if (table === "residents") return builder(opts.residentsList, opts.residentSingle);
      if (table === "invoices") return builder(opts.invoicesList, opts.invoiceSingle ?? null);
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

  it("preserves a deep-linked resident and unavailable invoice intent", async () => {
    const { container } = render(<AdminNewPaymentPage />);

    // A1: the prefilled resident (outside the active cohort) is merged in as an option.
    expect(await screen.findByRole("option", { name: "Prefill, Pat" })).toBeInTheDocument();

    const selects = () => Array.from(container.querySelectorAll("select"));
    await waitFor(() => expect((selects()[0] as HTMLSelectElement).value).toBe("r-pre"));

    // A2: unavailable invoice intent remains selected until the operator changes it.
    await waitFor(() => {
      const invoiceSelect = selects()[1] as HTMLSelectElement | undefined;
      expect(invoiceSelect).toBeDefined();
      expect(invoiceSelect!.value).toBe("inv-closed");
    });
    expect(screen.getByRole("option", { name: /INV-OPEN/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /inv-closed/i })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("selected invoice is not available");
    expect(screen.getByRole("button", { name: "Record payment" })).toBeDisabled();
  });

  it("resolves a valid requested invoice outside the first page without losing its association", async () => {
    mocks.searchParams = new URLSearchParams({residentId:"r-a",invoiceId:"inv-older",amount:"10.00"});
    mocks.client = makeClient({
      residentsList:[{id:"r-a",first_name:"Amy",last_name:"Active"}],residentSingle:null,
      invoicesList:Array.from({length:50},(_,index)=>({id:`inv-${index}`,invoice_number:`RECENT-${index}`,balance_due:5000,status:"sent",period_start:"2026-08-01",period_end:"2026-08-31"})),
      invoiceSingle:{id:"inv-older",invoice_number:"OLDER-OPEN",balance_due:5000,status:"sent",period_start:"2026-01-01",period_end:"2026-01-31"},
    });
    render(<AdminNewPaymentPage />);
    expect(await screen.findByRole("option",{name:/OLDER-OPEN/})).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")[1]).toHaveValue("inv-older");
    expect(screen.getByRole("button",{name:"Record payment"})).toBeEnabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:"P0001",message:"Test transaction rollback"}});
    await act(async () => { fireEvent.submit(screen.getByRole("button",{name:"Record payment"}).closest("form")!); });
    expect(mocks.rpc.mock.lastCall?.[1].p_invoice_id).toBe("inv-older");
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

describe("atomic payment recording recovery", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.actor = "actor";
    mocks.selectedFacilityId = "11111111-1111-1111-1111-111111111111";
    mocks.searchParams = new URLSearchParams({residentId:"r-a", invoiceId:"inv-open", amount:"10.00"});
    mocks.client = makeClient({ residentsList:[{id:"r-a",first_name:"Amy",last_name:"Active"}], residentSingle:null,
      invoicesList:[{id:"inv-open",invoice_number:"INV-OPEN",balance_due:5000,status:"sent",period_start:"2026-05-01",period_end:"2026-05-31"}] });
  });
  async function submit() {
    await screen.findByRole("option", {name:/INV-OPEN/});
    await act(async () => { fireEvent.submit(screen.getByRole("button", {name:"Record payment"}).closest("form")!); });
  }
  it("locks an ambiguous attempt and recovers exactly one confirmed receipt", async () => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:"connection lost"}})
      .mockImplementationOnce(async (_name, args) => ({error:null,data:{request_id:args.p_request_id,payment_id:"payment",resident_id:args.p_resident_id,invoice_id:args.p_invoice_id,amount_cents:args.p_amount_cents,applied_cents:args.p_amount_cents}}));
    render(<AdminNewPaymentPage />);
    await submit();
    expect(await screen.findByText(/Details are locked/)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toBeDisabled();
    expect(screen.queryByText("Payment recorded")).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("button",{name:"Retry same payment"}).closest("form")!);
    expect(await screen.findByText("Payment recorded")).toBeInTheDocument();
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
    expect(mocks.rpc.mock.calls[1]).toEqual(mocks.rpc.mock.calls[0]);
    expect(mocks.rpc.mock.calls[0][0]).toBe("record_payment");
  });
  it("allows correction after an initial confirmed rollback", async () => {
    mocks.rpc.mockResolvedValueOnce({data:null,error:{code:"P0001",message:"Payment must not exceed the current open invoice balance"}});
    render(<AdminNewPaymentPage />); await submit();
    expect(await screen.findByText(/Nothing was recorded/)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).not.toBeDisabled();
  });
  it("does not unlock an ambiguous request after a later SQL denial", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce({data:null,error:{code:"42501",message:"access denied"}});
    render(<AdminNewPaymentPage />); await submit();
    fireEvent.submit((await screen.findByRole("button",{name:"Retry same payment"})).closest("form")!);
    expect(await screen.findByText(/Details are locked/)).toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toBeDisabled();
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
    expect(mocks.rpc.mock.calls[1]).toEqual(mocks.rpc.mock.calls[0]);
  });
  it("does not report success without a complete matching receipt", async () => {
    mocks.rpc.mockResolvedValueOnce({data:{payment_id:"payment"},error:null});
    render(<AdminNewPaymentPage />); await submit();
    expect(await screen.findByText(/Details are locked/)).toBeInTheDocument();
    expect(screen.queryByText("Payment recorded")).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toBeDisabled();
  });
  it("blocks a changed account from retrying and preserves original attribution", async () => {
    mocks.rpc.mockRejectedValueOnce(new Error("lost response"));
    render(<AdminNewPaymentPage />); await submit();
    await screen.findByText(/Details are locked/);
    expect(mocks.rpc.mock.calls[0][1].p_expected_caller).toBe("actor");
    mocks.actor = "different-actor";
    await act(async () => { fireEvent.submit(screen.getByRole("button",{name:"Retry same payment"}).closest("form")!); });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("spinbutton")).toBeDisabled();
    mocks.actor = "actor";
  });

});
