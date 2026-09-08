import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AdminDischargeDetailPage from "./page";

const mocks = vi.hoisted(() => {
  const reconciliation = {
    id: "10000000-0000-4000-8000-000000000001",
    resident_id: "10000000-0000-4000-8000-000000000002",
    facility_id: "10000000-0000-4000-8000-000000000003",
    status: "pending",
    expected_discharge_date: null,
    nurse_reconciliation_notes: null,
    pharmacist_notes: null,
    pharmacist_npi: null,
    pharmacist_attested_at: null,
    pharmacist_attested_by: null,
    nursing_completed_at: null,
    nursing_completed_by: null,
    residents: {
      first_name: "Test",
      last_name: "Resident",
      status: "active",
      discharge_date: null,
      discharge_target_date: null,
      hospice_status: "none",
    },
  };
  const query = {
    select: vi.fn(),
    update: vi.fn(),
    single: vi.fn().mockResolvedValue({ data: null, error: { message: "No authorized resident row", code: "PGRST116" } }),
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({ data: reconciliation, error: null }),
  };
  query.select.mockReturnValue(query);
  query.update.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);

  return {
    query,
    supabase: { from: vi.fn(() => query) },
  };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "10000000-0000-4000-8000-000000000001" }),
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: "10000000-0000-4000-8000-000000000003" }),
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ user: { id: "10000000-0000-4000-8000-000000000004" } }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mocks.supabase,
}));

describe("AdminDischargeDetailPage official discharge date", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does not report discharge success when no authorized resident is returned", async () => {
    render(<AdminDischargeDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Complete official discharge" }));
    expect(await screen.findByText("Couldn't complete official discharge. Retry or refresh.")).toBeInTheDocument();
    expect(screen.queryByText("Official discharge recorded — resident is no longer billable.")).not.toBeInTheDocument();
    expect(mocks.query.single).toHaveBeenCalled();
  });

  it("explains an occupancy mismatch without claiming discharge success", async () => {
    mocks.query.single.mockResolvedValueOnce({ data: null, error: { message: "The resident bed assignment does not match current occupancy; reconcile it before discharge", code: "P0001" } });
    render(<AdminDischargeDetailPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Complete official discharge" }));
    expect(await screen.findByText("The bed assignment needs reconciliation before discharge. Ask a facility administrator to review the resident and bed records.")).toBeInTheDocument();
    expect(screen.queryByText("Official discharge recorded — resident is no longer billable.")).not.toBeInTheDocument();
  });

  it("defaults to the Eastern calendar date at 8:05pm ET after UTC rolls over", async () => {
    const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");
    vi.useFakeTimers();
    vi.setSystemTime(eightOhFivePmEt);

    render(<AdminDischargeDetailPage />);
    await act(async () => {
      await Promise.resolve();
    });

    const input = screen.getByLabelText("Official discharge date (ET)");
    expect(input).toHaveValue("2026-08-20");
    expect(input).not.toHaveValue("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });
});
