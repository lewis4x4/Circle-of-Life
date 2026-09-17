import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RegisterClient } from "./RegisterClient";
import { REGISTER_EVENT_TYPES, type RegisterRow } from "@/lib/registers/register";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));

function dbRow(overrides: Record<string, unknown>) {
  return {
    event_at: "2026-03-10T15:00:00Z",
    event_type: "admission",
    resident_id: "resident-1",
    resident_display_name: "Test Resident A",
    room_number: "101",
    bed_label: "A",
    room_as_of: "current",
    from_status: null,
    to_status: "active",
    admission_source: null,
    discharge_reason: null,
    discharge_destination: null,
    recorded_by: null,
    recorded_by_name: "Review clerk",
    ...overrides,
  };
}

function uiRow(overrides: Partial<RegisterRow> = {}): RegisterRow {
  return {
    eventAt: "2026-03-10T15:00:00Z",
    eventType: "admission",
    residentId: "resident-1",
    residentDisplayName: "Test Resident A",
    roomNumber: "101",
    bedLabel: "A",
    roomAsOf: "current",
    fromStatus: null,
    toStatus: "active",
    admissionSource: null,
    dischargeReason: null,
    dischargeDestination: null,
    recordedByName: "Review clerk",
    ...overrides,
  };
}

const FIXTURE: RegisterRow[] = [
  uiRow({ eventType: "admission", residentId: "r1" }),
  uiRow({ eventType: "admission", residentId: "r2" }),
  uiRow({ eventType: "admission", residentId: "r3" }),
  uiRow({ eventType: "discharge", residentId: "r4", fromStatus: "active", toStatus: "discharged" }),
  uiRow({ eventType: "discharge", residentId: "r5", fromStatus: "active", toStatus: "discharged" }),
  uiRow({ eventType: "hospital_out", residentId: "r6", fromStatus: "active", toStatus: "hospital_hold" }),
];

beforeEach(() => {
  mocks.rpc.mockReset();
  mocks.rpc.mockResolvedValue({ data: [], error: null });
});
afterEach(() => cleanup());

function renderRegister(props: Partial<Parameters<typeof RegisterClient>[0]> = {}) {
  return render(
    <RegisterClient
      organizationId="org-1"
      facilityId="fac-1"
      initialRows={FIXTURE}
      initialFrom="2026-02-10"
      initialTo="2026-03-12"
      loadError={null}
      {...props}
    />,
  );
}

describe("register counts", () => {
  it("counts what the fixture contains", async () => {
    renderRegister();
    expect(await screen.findByText("Admissions 3 · Discharges 2 · Hospital out 1")).toBeTruthy();
  });

  it("names a held bed as a bed hold and never as memory care", () => {
    renderRegister();
    expect(screen.getAllByText("Bed Hold: Hospital").length).toBeGreaterThan(0);
    expect(document.body.textContent?.toLowerCase()).not.toContain("memory care");
  });
});

describe("show bed holds", () => {
  it("asks the database for a register without the four hold types", async () => {
    const user = userEvent.setup();
    mocks.rpc.mockResolvedValue({
      data: REGISTER_EVENT_TYPES.filter(
        (t) => !["hospital_out", "hospital_return", "leave_out", "leave_return"].includes(t),
      ).map((event_type, i) => dbRow({ event_type, resident_id: `r${i}` })),
      error: null,
    });
    renderRegister();
    await user.click(screen.getByLabelText("Show bed holds"));
    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith(
        "admission_discharge_register",
        expect.objectContaining({ p_include_holds: false }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("To hospital")).toBeNull();
    });
  });
});

describe("facility switch", () => {
  it("refetches rather than showing the previous building's register", async () => {
    const { rerender } = renderRegister();
    mocks.rpc.mockClear();
    rerender(
      <RegisterClient
        organizationId="org-1"
        facilityId="fac-2"
        initialRows={FIXTURE}
        initialFrom="2026-02-10"
        initialTo="2026-03-12"
        loadError={null}
      />,
    );
    await waitFor(() => {
      expect(mocks.rpc).toHaveBeenCalledWith(
        "admission_discharge_register",
        expect.objectContaining({ p_facility_id: "fac-2" }),
      );
    });
  });
});

describe("empty facility", () => {
  it("says the range is empty instead of showing a blank table", async () => {
    renderRegister({ initialRows: [] });
    expect(
      await screen.findByText("No admissions or discharges recorded in Haven for this range."),
    ).toBeTruthy();
  });
});

describe("a row cannot be edited", () => {
  it("points at the flow that would correct it instead", async () => {
    const user = userEvent.setup();
    renderRegister({ initialRows: [uiRow({ eventType: "discharge", fromStatus: "active", toStatus: "discharged" })] });
    await user.click(screen.getByRole("button", { name: "Discharge" }));
    const link = await screen.findByRole("link", { name: "Full status history" });
    expect(link).toBeTruthy();
    expect(document.body.textContent).toContain("correct the status on the resident record");
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();
  });
});
