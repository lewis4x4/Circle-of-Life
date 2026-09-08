import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminNewCertificationPage from "./page";

const facilityId = "11111111-1111-1111-1111-111111111111";
const mocks = vi.hoisted(() => ({
  selectedFacilityId: "11111111-1111-1111-1111-111111111111" as string | null,
  user: { id: "user-1" } as { id: string } | null,
  staffQuery: vi.fn(),
  orgQuery: vi.fn(),
  insert: vi.fn(),
  eq: vi.fn(),
  is: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/admin/certifications/new",
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: () => ({ selectedFacilityId: mocks.selectedFacilityId }),
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ user: mocks.user }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => { mocks.eq(column, value); return query; },
        is: (column: string, value: unknown) => { mocks.is(column, value); return query; },
        order: () => query,
        limit: mocks.staffQuery,
        maybeSingle: mocks.orgQuery,
        insert: (payload: unknown) => { mocks.insert(payload); return query; },
        single: async () => ({ data: { id: "certification-1" }, error: null }),
      };
      return query;
    },
  }),
}));

function enterCredential() {
  const fields = {
    category: screen.getAllByRole("combobox")[1] as HTMLSelectElement,
    name: screen.getByPlaceholderText("e.g. American Heart BLS — Healthcare Provider"),
    authority: screen.getByPlaceholderText("e.g. AHA Training Center, FL BON"),
    issue: screen.getByLabelText("Issue date (ET)"),
    expiration: screen.getByLabelText("Expiration (optional, ET)"),
  };
  const categoryValue = fields.category.options[1].value;
  fireEvent.change(fields.category, { target: { value: categoryValue } });
  fireEvent.change(fields.name, { target: { value: "Medication administration" } });
  fireEvent.change(fields.authority, { target: { value: "Training authority" } });
  fireEvent.change(fields.issue, { target: { value: "2026-08-01" } });
  fireEvent.change(fields.expiration, { target: { value: "2027-08-01" } });
  return () => {
    expect(fields.category).toHaveValue(categoryValue);
    expect(fields.name).toHaveValue("Medication administration");
    expect(fields.authority).toHaveValue("Training authority");
    expect(fields.issue).toHaveValue("2026-08-01");
    expect(fields.expiration).toHaveValue("2027-08-01");
  };
}

function expectRepeatedFacilityScope() {
  expect(mocks.staffQuery).toHaveBeenCalledTimes(2);
  expect(mocks.eq.mock.calls).toEqual([
    ["facility_id", facilityId], ["employment_status", "active"],
    ["facility_id", facilityId], ["employment_status", "active"],
  ]);
  expect(mocks.is.mock.calls).toEqual([["deleted_at", null], ["deleted_at", null]]);
}

describe("AdminNewCertificationPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectedFacilityId = facilityId;
    mocks.user = { id: "user-1" };
    mocks.staffQuery.mockReset().mockResolvedValue({ data: [], error: null });
    mocks.orgQuery.mockReset().mockResolvedValue({ data: { organization_id: "org-1" }, error: null });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("defaults issue date to Eastern today after 8pm ET and leaves expiration empty", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T20:05:00-04:00"));
    await act(async () => { render(<AdminNewCertificationPage />); });
    expect(screen.getByLabelText("Issue date (ET)")).toHaveValue("2026-08-20");
    expect(screen.getByLabelText("Expiration (optional, ET)")).toHaveValue("");
  });

  it("names a successful empty staff result without offering error recovery", async () => {
    render(<AdminNewCertificationPage />);
    expect(await screen.findByText("No active staff in this facility.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry staff load" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save certification" })).toBeDisabled();
  });

  it("retries the facility-scoped query successfully and retains every entered credential field", async () => {
    // PostgREST returns a plain error object, not necessarily an Error instance.
    mocks.staffQuery.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "Permission denied" } })
      .mockResolvedValueOnce({ data: [{ id: "staff-1", first_name: "Maya", last_name: "Smith" }], error: null });
    render(<AdminNewCertificationPage />);
    await screen.findByRole("button", { name: "Retry staff load" });
    expect(screen.getByRole("alert")).toHaveTextContent("Eligible staff could not be loaded");
    expect(screen.queryByText("No active staff in this facility.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save certification" })).toBeDisabled();
    const expectRetained = enterCredential();
    fireEvent.click(screen.getByRole("button", { name: "Retry staff load" }));
    expect(await screen.findByRole("option", { name: "Smith, Maya" })).toBeInTheDocument();
    expectRepeatedFacilityScope();
    expectRetained();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("No active staff in this facility.")).not.toBeInTheDocument();
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "staff-1" } });
    expect(screen.getByRole("button", { name: "Save certification" })).toBeEnabled();
  });

  it("changes failure to successful-empty after retry without discarding credential fields", async () => {
    mocks.staffQuery.mockRejectedValueOnce(new Error("Network unavailable"));
    render(<AdminNewCertificationPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Network unavailable");
    const expectRetained = enterCredential();
    fireEvent.click(screen.getByRole("button", { name: "Retry staff load" }));
    expect(await screen.findByText("No active staff in this facility.")).toBeInTheDocument();
    expectRepeatedFacilityScope();
    expectRetained();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save certification" })).toBeDisabled();
  });

  it("keeps a repeated failure distinct from an empty roster and preserves the form", async () => {
    mocks.staffQuery.mockRejectedValueOnce(new Error("Network unavailable"))
      .mockRejectedValueOnce(new Error("Still unavailable"));
    render(<AdminNewCertificationPage />);
    await screen.findByRole("button", { name: "Retry staff load" });
    const expectRetained = enterCredential();
    fireEvent.click(screen.getByRole("button", { name: "Retry staff load" }));
    expect(await screen.findByText(/Still unavailable/)).toBeInTheDocument();
    expectRepeatedFacilityScope();
    expectRetained();
    expect(screen.queryByText("No active staff in this facility.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save certification" })).toBeDisabled();
  });

  it.each(["success", "failure"])("ignores a delayed facility A retry %s after facility B completes", async (outcome) => {
    let resolveA!: (value: unknown) => void;
    let rejectA!: (reason: Error) => void;
    const delayedA = new Promise((resolve, reject) => { resolveA = resolve; rejectA = reject; });
    const staffB = { id: "staff-b", first_name: "Bea", last_name: "Baker" };
    mocks.staffQuery.mockRejectedValueOnce(new Error("Initial A failure"))
      .mockReturnValueOnce(delayedA)
      .mockResolvedValueOnce({ data: outcome === "success" ? [] : [staffB], error: null });
    const view = render(<AdminNewCertificationPage />);
    await screen.findByRole("button", { name: "Retry staff load" });
    const expectRetained = enterCredential();
    fireEvent.click(screen.getByRole("button", { name: "Retry staff load" }));
    mocks.selectedFacilityId = "22222222-2222-2222-2222-222222222222";
    view.rerender(<AdminNewCertificationPage />);
    if (outcome === "success") {
      await screen.findByText("No active staff in this facility.");
    } else {
      await screen.findByRole("option", { name: "Baker, Bea" });
      fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: staffB.id } });
    }
    await act(async () => {
      if (outcome === "success") resolveA({ data: [{ id: "staff-a", first_name: "Ada", last_name: "Adams" }], error: null });
      else rejectA(new Error("Late facility A failure"));
    });
    expect(mocks.staffQuery).toHaveBeenCalledTimes(3);
    expect(mocks.eq.mock.calls.filter(([column]) => column === "facility_id")).toEqual([
      ["facility_id", facilityId], ["facility_id", facilityId], ["facility_id", mocks.selectedFacilityId],
    ]);
    expect(screen.queryByRole("option", { name: "Adams, Ada" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expectRetained();
    if (outcome === "success") {
      expect(screen.getByText("No active staff in this facility.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save certification" })).toBeDisabled();
    } else {
      expect(screen.getByRole("option", { name: "Baker, Bea" })).toBeInTheDocument();
      expect(screen.getAllByRole("combobox")[0]).toHaveValue(staffB.id);
      expect(screen.getByRole("button", { name: "Save certification" })).toBeEnabled();
    }
  });

  it("invalidates the previous facility's selected staff while retaining credential input", async () => {
    let finishB!: (value: unknown) => void;
    mocks.staffQuery.mockResolvedValueOnce({ data: [{ id: "staff-a", first_name: "Ada", last_name: "Adams" }], error: null })
      .mockReturnValueOnce(new Promise((resolve) => { finishB = resolve; }));
    const view = render(<AdminNewCertificationPage />);
    await screen.findByRole("option", { name: "Adams, Ada" });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "staff-a" } });
    const expectRetained = enterCredential();
    mocks.selectedFacilityId = "22222222-2222-2222-2222-222222222222";
    view.rerender(<AdminNewCertificationPage />);
    expect(screen.getAllByRole("combobox")[0]).toHaveValue("");
    expect(screen.queryByRole("option", { name: "Adams, Ada" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save certification" })).toBeDisabled();
    await act(async () => { finishB({ data: [{ id: "staff-b", first_name: "Bea", last_name: "Baker" }], error: null }); });
    expect(screen.getAllByRole("combobox")[0]).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save certification" })).toBeDisabled();
    expectRetained();
  });

  it("does not let an obsolete request's finally clear the current facility's loading state", async () => {
    let finishA!: (value: unknown) => void;
    let finishB!: (value: unknown) => void;
    mocks.staffQuery.mockReturnValueOnce(new Promise((resolve) => { finishA = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { finishB = resolve; }));
    const view = render(<AdminNewCertificationPage />);
    mocks.selectedFacilityId = "22222222-2222-2222-2222-222222222222";
    view.rerender(<AdminNewCertificationPage />);
    await act(async () => { finishA({ data: [], error: null }); });
    expect(screen.getAllByRole("combobox")[0]).toBeDisabled();
    expect(screen.queryByText("No active staff in this facility.")).not.toBeInTheDocument();
    await act(async () => { finishB({ data: [], error: null }); });
    expect(screen.getByText("No active staff in this facility.")).toBeInTheDocument();
  });


  it("rejects the old generation even when the operator switches A to B and back to A", async () => {
    let finishOldA!: (value: unknown) => void;
    mocks.staffQuery.mockReturnValueOnce(new Promise((resolve) => { finishOldA = resolve; }))
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [{ id: "new-a", first_name: "Current", last_name: "Roster" }], error: null });
    const view = render(<AdminNewCertificationPage />);
    mocks.selectedFacilityId = "22222222-2222-2222-2222-222222222222";
    view.rerender(<AdminNewCertificationPage />);
    await screen.findByText("No active staff in this facility.");
    mocks.selectedFacilityId = facilityId;
    view.rerender(<AdminNewCertificationPage />);
    await screen.findByRole("option", { name: "Roster, Current" });
    await act(async () => { finishOldA({ data: [{ id: "old-a", first_name: "Old", last_name: "Roster" }], error: null }); });
    expect(screen.getByRole("option", { name: "Roster, Current" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Roster, Old" })).not.toBeInTheDocument();
  });

  it("does not insert a stale staff selection if facility changes while resolving its organization", async () => {
    let finishOrg!: (value: unknown) => void;
    mocks.orgQuery.mockReturnValueOnce(new Promise((resolve) => { finishOrg = resolve; }));
    mocks.staffQuery.mockResolvedValueOnce({ data: [{ id: "staff-a", first_name: "Ada", last_name: "Adams" }], error: null });
    const view = render(<AdminNewCertificationPage />);
    await screen.findByRole("option", { name: "Adams, Ada" });
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "staff-a" } });
    const expectRetained = enterCredential();
    fireEvent.click(screen.getByRole("button", { name: "Save certification" }));
    expect(mocks.orgQuery).toHaveBeenCalledTimes(1);
    mocks.selectedFacilityId = "22222222-2222-2222-2222-222222222222";
    view.rerender(<AdminNewCertificationPage />);
    await screen.findByText("No active staff in this facility.");
    await act(async () => { finishOrg({ data: { organization_id: "org-a" }, error: null }); });
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save certification" })).toBeDisabled();
    expectRetained();
  });

});
