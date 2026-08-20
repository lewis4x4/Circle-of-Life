import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminNewCollectionActivityPage from "./page";

type AnyRow = Record<string, unknown>;

const PINNED_FACILITY = "11111111-1111-1111-1111-111111111111";
const RESIDENT_FACILITY = "22222222-2222-2222-2222-222222222222";

const mocks = vi.hoisted(() => ({
  searchParams: new URLSearchParams(""),
  selectedFacilityId: "11111111-1111-1111-1111-111111111111" as string | null,
  client: { from: () => ({}) as unknown },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => mocks.searchParams,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/billing/collections/new",
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

function makeClient(opts: { residentsList: AnyRow[]; residentSingle: AnyRow | null; invoicesList: AnyRow[] }) {
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

describe("AdminNewCollectionActivityPage facility derivation", () => {
  beforeEach(() => {
    mocks.searchParams = new URLSearchParams({ residentId: "r-pre" });
    mocks.selectedFacilityId = PINNED_FACILITY;
    mocks.client = makeClient({
      residentsList: [
        { id: "r-a", first_name: "Amy", last_name: "Active" },
      ],
      // Deep-linked resident belongs to a DIFFERENT facility than the pinned one.
      residentSingle: { id: "r-pre", first_name: "Pat", last_name: "Prefill", facility_id: RESIDENT_FACILITY },
      invoicesList: [],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("posts the resident's facility, not the pinned facility", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: "act-1" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<AdminNewCollectionActivityPage />);

    // Wait for the prefilled resident to be merged in (residents finished loading).
    expect(await screen.findByRole("option", { name: "Prefill, Pat" })).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("What was discussed or sent?"),
      "Called about overdue balance",
    );
    await user.click(screen.getByRole("button", { name: /save activity/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("/api/admin/workflows/collection-activities");
    const body = JSON.parse(init.body) as { facility_id: string; resident_id: string };
    expect(body.resident_id).toBe("r-pre");
    expect(body.facility_id).toBe(RESIDENT_FACILITY);

    vi.unstubAllGlobals();
  });

  it("formats internal persist keys in the invoice picker", async () => {
    mocks.searchParams = new URLSearchParams({ residentId: "r-a" });
    mocks.client = makeClient({
      residentsList: [{ id: "r-a", first_name: "Amy", last_name: "Active" }],
      residentSingle: null,
      invoicesList: [
        {
          id: "b5000000-0000-0000-0000-0000000000a1",
          invoice_number: "00000000-2026-08-c0000000-0000-0000-0000-0000000000a1",
          invoice_date: "2026-08-01",
          balance_due: 2500,
          status: "overdue",
          period_start: "2026-08-01",
          period_end: "2026-08-31",
        },
      ],
    });

    render(<AdminNewCollectionActivityPage />);

    expect(await screen.findByRole("option", { name: /Invoice Aug 2026 · …00a1/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /00000000-2026-08/ })).toBeNull();
  });
});
