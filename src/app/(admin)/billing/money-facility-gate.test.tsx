import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import CollectionsPage from "./collections/page";
import ConcessionsPage from "./concessions/page";
import GenerateInvoicesPage from "./invoices/generate/page";
import OpeningBalancePage from "./invoices/opening-balance/page";
import RatesPage from "./rates/page";
import NewRatePage from "./rates/new/page";
import PayrollPage from "../payroll/page";
import NewPayrollBatchPage from "../payroll/new/page";
import PayrollBatchPage from "../payroll/[id]/page";
import CashPage from "../admin/cash/page";
import LettersPage from "../admin/letters/page";
import GenerateLetterPage from "../admin/letters/generate/page";

// COL-651: under "All facilities" every per-building money page shows the one
// shared gate (title, reason, facilities to choose) — never a warning banner,
// a Retry, a zero KPI, or a form that cannot be submitted.

const store = vi.hoisted(() => ({
  selectedFacilityId: null as string | null,
  availableFacilities: [
    { id: "00000000-0000-4000-8000-000000000001", name: "Homewood Lodge" },
    { id: "00000000-0000-4000-8000-000000000002", name: "Oakridge ALF" },
  ],
  facilitiesCacheUserId: "user-1",
  setSelectedFacility: vi.fn(() => true),
  setAvailableFacilities: vi.fn(),
}));

const nav = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, refresh: () => {} },
  searchParams: new URLSearchParams(),
  params: { id: "batch-1" },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => nav.router,
  useSearchParams: () => nav.searchParams,
  useParams: () => nav.params,
  usePathname: () => "/admin/billing",
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: Object.assign(
    (select?: (state: typeof store) => unknown) => (select ? select(store) : store),
    { getState: () => store },
  ),
}));
const auth = vi.hoisted(() => ({ user: { id: "user-1" }, organizationId: "org-1", appRole: "owner", loading: false }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => auth }));
vi.mock("@/lib/admin-facilities", () => ({ fetchAdminFacilityOptions: vi.fn(async () => store.availableFacilities) }));
vi.mock("@/lib/office/meetings", () => ({
  fetchActorContext: async () => ({ userId: "user-1", organizationId: "org-1" }),
}));
vi.mock("@/lib/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  for (const key of ["select", "eq", "in", "is", "or", "order", "limit", "gte", "lte", "range", "maybeSingle", "single"]) {
    builder[key] = () => builder;
  }
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
  const client = { from: () => builder, rpc: async () => ({ data: null, error: null }) };
  return { createClient: () => client };
});
vi.mock("./billing-hub-nav", () => ({ BillingHubNav: () => null }));

afterEach(cleanup);

function expectGate() {
  expect(screen.getByTestId("facility-gate")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Homewood Lodge" })).toBeInTheDocument();
  expect(screen.queryByText(/select a facility|pick a facility|choose a facility from the header/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
}

describe("money pages under All facilities (COL-651)", () => {
  it("collections: the gate, not a load error with Retry, and no Log Activity", async () => {
    render(<CollectionsPage />);
    expect(await screen.findByTestId("facility-gate")).toBeInTheDocument();
    expectGate();
    expect(screen.queryByText("+ Log Activity")).not.toBeInTheDocument();
    expect(screen.queryByText("No collection activities")).not.toBeInTheDocument();
  });

  it("concessions: the gate, not an error or an empty register", async () => {
    render(<ConcessionsPage />);
    expect(await screen.findByTestId("facility-gate")).toBeInTheDocument();
    expectGate();
    expect(screen.queryByText("No concession rows")).not.toBeInTheDocument();
  });

  it("invoice generation: titled gate, no month picker or preview", () => {
    render(<GenerateInvoicesPage />);
    expectGate();
    expect(screen.getByRole("heading", { level: 1, name: /Generate invoices/ })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Billing month" })).not.toBeInTheDocument();
  });

  it("opening balance: no form while gated", () => {
    render(<OpeningBalancePage />);
    expectGate();
    expect(screen.queryByRole("button", { name: /Create opening balance invoice/ })).not.toBeInTheDocument();
  });

  it("new rate schedule: no form while gated", () => {
    render(<NewRatePage />);
    expectGate();
    expect(screen.queryByLabelText("Schedule name")).not.toBeInTheDocument();
  });

  it("payroll: no 'Export Batches 0' KPI or New Batch beside the gate", () => {
    render(<PayrollPage />);
    expectGate();
    expect(screen.queryByText("Export Batches")).not.toBeInTheDocument();
    expect(screen.queryByText("+ New Batch")).not.toBeInTheDocument();
  });

  it("new payroll batch and batch detail: gated", () => {
    render(<NewPayrollBatchPage />);
    expectGate();
    expect(screen.queryByLabelText("Provider key")).not.toBeInTheDocument();
    cleanup();
    render(<PayrollBatchPage />);
    expectGate();
    expect(screen.getByRole("heading", { level: 1, name: "Payroll batch" })).toBeInTheDocument();
  });

  it("cash and letters: the shared gate", () => {
    for (const Page of [CashPage, LettersPage, GenerateLetterPage]) {
      render(<Page />);
      expectGate();
      cleanup();
    }
  });

  it("rate schedules roll up across facilities, so the empty state does not ask for one", async () => {
    render(<RatesPage />);
    expect(await screen.findByText("No rate schedules")).toBeInTheDocument();
    expect(screen.getByText(/No facility has a posted rate schedule yet/)).toBeInTheDocument();
    expect(screen.queryByTestId("facility-gate")).not.toBeInTheDocument();
  });
});
