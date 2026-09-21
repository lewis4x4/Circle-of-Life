import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatCents } from "@/lib/finance/format-cents";

import AdminOpeningBalancePage from "./page";

const pageSource = fs.readFileSync(path.resolve(import.meta.dirname, "./page.tsx"), "utf8");

type AnyRow = Record<string, unknown>;

const PINNED_FACILITY = "11111111-1111-1111-1111-111111111111";

const mocks = vi.hoisted(() => ({
  selectedFacilityId: "11111111-1111-1111-1111-111111111111" as string | null,
  rpc: vi.fn(),
  client: { from: (table: string) => ({ table }) as unknown, rpc: vi.fn() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/billing/invoices/opening-balance",
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({
    selectedFacilityId: mocks.selectedFacilityId,
    availableFacilities: [{ id: PINNED_FACILITY, name: "Homewood Lodge, ALF" }],
  }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mocks.client,
}));
vi.mock("@/components/ui/entity-combobox", () => ({
  EntityCombobox: ({ id, label, options, value, onChange }: {
    id: string;
    label: string;
    options: Array<{ id: string; label: string }>;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <label htmlFor={id}>
      {label}
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select resident</option>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    </label>
  ),
}));
vi.mock("@/components/ui/quiet-date-picker", () => ({
  QuietDatePicker: ({ id, value, onValueChange }: {
    id: string;
    value: string;
    onValueChange: (value: string) => void;
  }) => <input id={id} type="date" value={value} onChange={(event) => onValueChange(event.target.value)} />,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: {
    value: string;
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <select id="opening-balance-payer-type" value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder: string }) => <option value="">{placeholder}</option>,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
vi.mock("../../billing-hub-nav", () => ({ BillingHubNav: () => null }));

function makeClient(residentsList: AnyRow[]) {
  const q: AnyRow = {
    select: () => q,
    is: () => q,
    in: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    then: (resolve: (v: { data: AnyRow[]; error: null }) => unknown) =>
      Promise.resolve({ data: residentsList, error: null }).then(resolve),
  };
  return {
    from: (table: string) => {
      if (table === "residents") return q;
      return q;
    },
    rpc: mocks.rpc,
  };
}

describe("AdminOpeningBalancePage", () => {
  beforeEach(() => {
    mocks.selectedFacilityId = PINNED_FACILITY;
    mocks.rpc.mockResolvedValue({
      data: [{ invoice_id: "inv-1", inserted: true }],
      error: null,
    });
    mocks.client = makeClient([
      {
        id: "a0000000-0000-4000-8000-0000000000a1",
        first_name: "Alex",
        last_name: "Alpha",
        organization_id: "b0000000-0000-4000-8000-000000000001",
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("requires review before creating an explicitly classified opening balance", async () => {
    const user = userEvent.setup();
    const { container } = render(<AdminOpeningBalancePage />);
    await screen.findByRole("option", { name: "Alpha, Alex" });
    await user.selectOptions(screen.getByLabelText("Resident"), "a0000000-0000-4000-8000-0000000000a1");
    await user.type(screen.getByRole("spinbutton", { name: /opening balance/i }), "123.45");
    fireEvent.change(screen.getByLabelText(/due date/i), { target: { value: "2026-09-30" } });
    await user.selectOptions(screen.getByLabelText(/payer type/i), "private_pay");
    await user.type(screen.getByLabelText(/payer name/i), "Responsible party");

    expect(screen.getByRole("button", { name: "Review opening balance" })).toBeInTheDocument();
    fireEvent.submit(container.querySelector("form")!);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(await screen.findByText("Review complete. Confirm to create the draft invoice.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create draft invoice" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("create_finance_opening_balance", expect.objectContaining({ p_amount_cents: 12345 })));
    expect(await screen.findByText("Opening balance created")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View invoice" })).toHaveAttribute("href", "/admin/billing/invoices/inv-1");
  });

  it("does not ship July 2026 launch copy or AR-report wording", () => {
    expect(pageSource).not.toMatch(/July\s+2026/i);
    expect(pageSource).not.toMatch(/AR report/i);
    expect(pageSource).not.toMatch(/AR import/i);
    expect(pageSource).not.toMatch(/Michelle/i);
    expect(pageSource).not.toContain("2026-07-01");
    expect(pageSource).not.toContain("2026-07-05");
  });

  it("defaults the opening-balance date to Eastern calendar today and leaves financial assumptions empty", async () => {
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(eightOhFivePmEt);

    try {
      render(<AdminOpeningBalancePage />);

      const periodStartInput = await screen.findByLabelText(/opening balance as of/i);
      expect(periodStartInput).toHaveValue("2026-08-20");
      expect(periodStartInput).not.toHaveValue("2026-08-21");

      const dueDateInput = screen.getByLabelText(/due date/i);
      expect(dueDateInput).toHaveValue("");

      const notesInput = screen.getByLabelText(/^source note$/i);
      expect(notesInput).toHaveValue("");
      expect(screen.getByLabelText(/payer name/i)).toHaveValue("");
      expect(screen.getByText("Select payer type")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses todayFacilityDateIso for period start, not a UTC ISO slice", () => {
    expect(pageSource).toContain("todayFacilityDateIso()");
    expect(pageSource).not.toMatch(
      /useState\(\s*["']2026-07-/,
    );
    expect(pageSource).not.toMatch(
      /useState\(\s*\(\)\s*=>\s*new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/,
    );
  });

  it("shows generic opening-balance copy", async () => {
    render(<AdminOpeningBalancePage />);

    expect(screen.getByRole("heading", { name: "Enter opening balance" })).toBeInTheDocument();
    expect(
      screen.getByText(/carry a resident's prior receivable into haven as a draft invoice/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/july 2026/i)).toBeNull();
    expect(screen.queryByText(/ar report/i)).toBeNull();

    expect(await screen.findByRole("option", { name: "Alpha, Alex" })).toBeInTheDocument();
  });

  it("formats success amount from integer cents via formatCents", () => {
    expect(pageSource).toContain("formatCents(amountCents)");
    expect(pageSource).not.toContain("billingCurrency");
    expect(formatCents(165_000)).toBe("$1,650.00");
  });
});
