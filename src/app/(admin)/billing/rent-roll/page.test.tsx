import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectedFacilityId: null as string | null,
  availableFacilities: [{ id: "00000000-0000-0000-0002-000000000003", name: "Homewood Lodge, ALF" }],
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
  fetchRentRoll: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn() }),
  useSearchParams: () => mocks.searchParams,
  usePathname: () => "/admin/billing/rent-roll",
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({
    selectedFacilityId: mocks.selectedFacilityId,
    availableFacilities: mocks.availableFacilities,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

vi.mock("@/lib/billing/load-rent-roll", async () => {
  const actual = await vi.importActual<typeof import("@/lib/billing/load-rent-roll")>("@/lib/billing/load-rent-roll");
  return { ...actual, fetchRentRollFromSupabase: mocks.fetchRentRoll };
});

vi.mock("@/components/common/FacilityGate", () => ({
  FacilityGateNotice: ({ reason }: { reason: string }) => <section data-testid="facility-gate">{reason}</section>,
}));

vi.mock("../billing-hub-nav", () => ({ BillingHubNav: () => <nav data-testid="hub-nav" /> }));

import { buildRentRoll } from "@/lib/billing/rent-roll-model";

import AdminBillingRentRollPage from "./page";

const HOMEWOOD = "00000000-0000-0000-0002-000000000003";

function homewoodSeptember(withPayments: boolean) {
  return buildRentRoll({
    period: { year: 2026, month: 9 },
    residents: [
      {
        id: "res-baker",
        firstName: "Jimmie",
        lastName: "Baker",
        status: "active",
        admissionDate: "2021-06-23",
        dischargeDate: null,
        admissionSource: "Bedrock of Live Oak Fl",
        monthlyTotalRateCents: null,
        roomLabel: "7-B",
        bedLabel: "B",
      },
      {
        id: "res-budd",
        firstName: "Sharon",
        lastName: "Budd",
        status: "active",
        admissionDate: "2026-05-28",
        dischargeDate: null,
        admissionSource: null,
        monthlyTotalRateCents: null,
        roomLabel: null,
        bedLabel: null,
      },
    ],
    payers: [
      {
        residentId: "res-baker",
        payerType: "medicaid_oss",
        payerName: "UHC",
        providerName: null,
        payerShareType: "fixed_amount",
        payerFixedAmountCents: 300900,
        medicaidRateCents: 160000,
        medicaidRateUnit: "monthly",
        medicaidPatientResponsibilityCents: 140900,
        effectiveDate: "2026-05-01",
        endDate: null,
      },
    ],
    payments: withPayments
      ? [
          {
            residentId: "res-baker",
            amountCents: 140900,
            paymentDate: "2026-09-03",
            paymentMethod: "check",
            payerType: "private_pay",
            refunded: false,
            refundAmountCents: null,
          },
        ]
      : [],
    invoices: [
      { residentId: "res-baker", status: "draft", totalCents: 300900, balanceDueCents: 300900, invoiceDate: "2026-09-01", periodStart: "2026-09-01" },
    ],
  });
}

describe("AdminBillingRentRollPage", () => {
  beforeEach(() => {
    mocks.selectedFacilityId = HOMEWOOD;
    mocks.searchParams = new URLSearchParams("period=2026-09");
    mocks.replace.mockReset();
    mocks.fetchRentRoll.mockReset();
  });

  it("asks for a facility instead of rolling the whole organization together", async () => {
    mocks.selectedFacilityId = null;
    render(<AdminBillingRentRollPage />);
    expect(await screen.findByTestId("facility-gate")).toHaveTextContent("kept per building");
    expect(mocks.fetchRentRoll).not.toHaveBeenCalled();
  });

  it("renders the sheet's columns, the month, and says plainly when no payments are recorded", async () => {
    mocks.fetchRentRoll.mockResolvedValue({
      roll: homewoodSeptember(false),
      planRates: [{ name: "United Healthcare", rateCents: 160000, rateUnit: "monthly" }],
    });
    render(<AdminBillingRentRollPage />);

    await screen.findByRole("table");
    expect(mocks.fetchRentRoll).toHaveBeenCalledWith(HOMEWOOD, { year: 2026, month: 9 }, expect.anything());

    for (const header of [
      "Room #",
      "Admit date",
      "Resident",
      "Total PVT & MCD",
      "PVT",
      "Paid privately",
      "Medicaid billed · DOS August 2026",
      "Medicaid paid · August 2026",
      "Outstanding",
      "Medicaid plan",
      "Notes",
      "Admitted from",
    ]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
    expect(screen.queryByRole("columnheader", { name: "Other source" })).not.toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Baker, Jimmie" })).toHaveAttribute("href", "/admin/residents/res-baker/billing");
    expect(screen.getByText("7-B")).toBeInTheDocument();
    expect(screen.getByText("No bed linked")).toBeInTheDocument();
    expect(screen.getByText("UHC")).toBeInTheDocument();
    expect(screen.getByText("No payer on file")).toBeInTheDocument();
    expect(screen.getByText("Bedrock of Live Oak Fl")).toBeInTheDocument();

    expect(screen.getByRole("status")).toHaveTextContent(/No payments are recorded in Haven for Homewood Lodge, ALF in September 2026/);
    expect(screen.getByText(/1 of the 1 Haven invoices for September 2026 are still drafts/)).toBeInTheDocument();
    expect(screen.getByText("Total contracted").nextElementSibling).toHaveTextContent("$3,009.00");
    expect(screen.getByText("Total outstanding").nextElementSibling).toHaveTextContent("$3,009.00");
    expect(screen.getByText("Collection rate").nextElementSibling).toHaveTextContent("0%");
    expect(screen.getByText(/2 residents · 1 without a rate on file/)).toBeInTheDocument();
    expect(screen.getByText(/Medicaid plan rates on file/).parentElement).toHaveTextContent("United Healthcare $1,600.00");
  });

  it("drops the no-payments notice once a payment is on file", async () => {
    mocks.fetchRentRoll.mockResolvedValue({ roll: homewoodSeptember(true), planRates: [] });
    render(<AdminBillingRentRollPage />);
    await screen.findByRole("table");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText("Total collected").nextElementSibling).toHaveTextContent("$1,409.00");
    expect(screen.getByText("Collection rate").nextElementSibling).toHaveTextContent("47%");
  });

  it("moves months through the URL rather than hidden state", async () => {
    mocks.fetchRentRoll.mockResolvedValue({ roll: homewoodSeptember(false), planRates: [] });
    render(<AdminBillingRentRollPage />);
    await screen.findByRole("table");
    screen.getByRole("button", { name: "Previous month" }).click();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("?period=2026-08"));
    screen.getByRole("button", { name: "Next month" }).click();
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("?period=2026-10"));
  });

  it("shows the load error and offers a retry instead of an empty sheet", async () => {
    mocks.fetchRentRoll.mockRejectedValue(new Error("payments: permission denied"));
    render(<AdminBillingRentRollPage />);
    expect(await screen.findByText(/payments: permission denied/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
