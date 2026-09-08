import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminStaffingConsolePageClient } from "./AdminStaffingConsolePageClient";
import type {
  AttendanceEventRow,
  CertWarning,
  RequisitionRow,
  ShiftGap,
  SnapshotRow,
  StaffOption,
} from "@/lib/staffing/load-staffing-console";

import * as staffingLoader from "@/lib/staffing/load-staffing-console";

const mocks = vi.hoisted(() => ({
  useFacilityStoreMock: vi.fn(),
  useSearchParamsMock: vi.fn(),
  createClientMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: mocks.useSearchParamsMock,
}));

vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: mocks.useFacilityStoreMock,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClientMock,
}));

const baseFacilityId = "11111111-1111-1111-1111-111111111111";

const loadedProps = {
  initialSnapshots: [
    {
      id: "snap-1",
      snapshotAt: "2026-05-26T12:00:00.000Z",
      shift: "Day",
      residentsPresent: 42,
      staffOnDuty: 5,
      ratio: 8.4,
      requiredRatio: 6.0,
      isCompliant: false,
    },
    {
      id: "snap-2",
      snapshotAt: "2026-05-26T08:00:00.000Z",
      shift: "Night",
      residentsPresent: 39,
      staffOnDuty: 6,
      ratio: 6.5,
      requiredRatio: 6.0,
      isCompliant: true,
    },
  ] satisfies SnapshotRow[],
  initialCertWarnings: [
    {
      id: "cert-1",
      staffName: "Jordan Blake",
      role: "CNA",
      certName: "Medication aide",
      daysExpired: 4,
    },
  ] satisfies CertWarning[],
  initialShiftGaps: [
    {
      id: "gap-1",
      date: "May 26",
      shift: "Night",
      role: "CNA",
      shortage: 2,
      urgency: "critical",
    },
  ] satisfies ShiftGap[],
  initialStaffOptions: [{ id: "staff-1", label: "Ava Lopez" }] satisfies StaffOption[],
  initialRequisitions: [
    {
      id: "req-1",
      role_title: "Caregiver",
      status: "open",
      target_hire_date: "2026-05-30",
      department: "Enhanced ALF",
    },
  ] satisfies RequisitionRow[],
  initialAttendance: [
    {
      id: "att-1",
      event_type: "callout",
      occurred_at: "2026-05-26T09:00:00.000Z",
      reason: "Vehicle trouble",
      staff: { first_name: "Ava", last_name: "Lopez" },
    },
  ] satisfies AttendanceEventRow[],
  initialError: null,
  initialFacilityId: baseFacilityId,
};

describe("<AdminStaffingConsolePageClient />", () => {
  beforeEach(() => {
    mocks.useSearchParamsMock.mockReturnValue(new URLSearchParams(""));
    mocks.useFacilityStoreMock.mockReturnValue({ selectedFacilityId: baseFacilityId });
    mocks.createClientMock.mockReturnValue({
      from: vi.fn(),
      auth: { getUser: vi.fn() },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("shows named loading copy while staffing data refetches", () => {
    mocks.useFacilityStoreMock.mockReturnValue({ selectedFacilityId: "22222222-2222-2222-2222-222222222222" });

    render(<AdminStaffingConsolePageClient {...loadedProps} />);

    expect(screen.getByText("Loading staffing…")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /workforce command/i })).not.toBeInTheDocument();
  });

  it("renders the operational staffing console with flat lists and action controls", async () => {
    const user = userEvent.setup();
    render(<AdminStaffingConsolePageClient {...loadedProps} />);

    expect(screen.getByRole("heading", { name: /workforce command/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /log attendance event/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /open positions/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /shift assignment gaps/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /credential warnings/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /recent ratio snapshots/i })).toBeInTheDocument();

    expect(screen.getByRole("option", { name: "Ava Lopez" })).toBeInTheDocument();
    expect(screen.getByText("Vehicle trouble")).toBeInTheDocument();
    expect(screen.getByText("Jordan Blake")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save attendance event/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /create open position/i })).toBeDisabled();
    expect(screen.getByRole("link", { name: /review schedule/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /review credential/i })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^staff member$/i), "staff-1");
    await user.type(screen.getByLabelText(/^role title$/i), "Caregiver");

    expect(screen.getByRole("button", { name: /save attendance event/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /create open position/i })).toBeEnabled();
  });

  it("shows a blocked staffing-directory state when no active ADP-linked staff are available", () => {
    mocks.useFacilityStoreMock.mockReturnValue({ selectedFacilityId: baseFacilityId });

    render(
      <AdminStaffingConsolePageClient
        {...loadedProps}
        initialStaffOptions={[]}
        initialAttendance={[]}
      />,
    );

    expect(screen.getByText(/no active staff came back from the adp-linked directory/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save attendance event/i })).toBeDisabled();
    expect(screen.getByText(/attendance logging blocked/i)).toBeInTheDocument();
    expect(screen.getByText(/once the active staff directory syncs/i)).toBeInTheDocument();
  });

  it("names the current ratio gap instead of a dash glyph when no snapshot is in scope", () => {
    render(
      <AdminStaffingConsolePageClient
        {...loadedProps}
        initialSnapshots={[]}
      />,
    );

    expect(screen.getByText("No ratio posted")).toBeInTheDocument();
    expect(screen.getByText("no live snapshot")).toBeInTheDocument();
    expect(screen.queryByText("--")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText("–")).not.toBeInTheDocument();
  });

  it("keeps a posted zero ratio numeric on the current ratio tile", () => {
    render(
      <AdminStaffingConsolePageClient
        {...loadedProps}
        initialSnapshots={[
          {
            id: "snap-zero",
            snapshotAt: "2026-05-26T12:00:00.000Z",
            shift: "Day",
            residentsPresent: 0,
            staffOnDuty: 5,
            ratio: 0,
            requiredRatio: 6.0,
            isCompliant: true,
          },
        ]}
      />,
    );

    expect(screen.getByText("0.0")).toBeInTheDocument();
    expect(screen.queryByText("No ratio posted")).not.toBeInTheDocument();
  });

  it("defaults attendance Occurred at to Eastern wall clock with ET label", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T20:06:00.000Z"));

    try {
      render(<AdminStaffingConsolePageClient {...loadedProps} />);

      const occurredAtInput = screen.getByLabelText(/^occurred at \(et\)$/i);
      expect(occurredAtInput).toHaveValue("2026-08-20T16:06");
      expect(occurredAtInput).not.toHaveValue("2026-08-20T20:06");
      expect(new Date("2026-08-20T20:06:00.000Z").toISOString().slice(0, 16)).toBe("2026-08-20T20:06");
    } finally {
      vi.useRealTimers();
    }
  });

  it("saves a callout through the reviewed-command RPC with Eastern time and reloads attendance", async () => {
    const user = userEvent.setup();
    const rpcMock = vi.fn().mockResolvedValue({ data: { id: "new-event" }, error: null });
    const fromMock = vi.fn();
    mocks.createClientMock.mockReturnValue({ rpc: rpcMock, from: fromMock });
    vi.spyOn(staffingLoader, "fetchSnapshotsFromSupabase").mockResolvedValue(loadedProps.initialSnapshots);
    vi.spyOn(staffingLoader, "fetchExpiredCertificationWarnings").mockResolvedValue(loadedProps.initialCertWarnings);
    vi.spyOn(staffingLoader, "fetchShiftAssignmentGaps").mockResolvedValue(loadedProps.initialShiftGaps);
    vi.spyOn(staffingLoader, "fetchStaffOptions").mockResolvedValue(loadedProps.initialStaffOptions);
    vi.spyOn(staffingLoader, "fetchStaffRequisitions").mockResolvedValue(loadedProps.initialRequisitions);
    const reload = vi.spyOn(staffingLoader, "fetchAttendanceEvents").mockResolvedValue([
      ...loadedProps.initialAttendance,
      { id: "new-event", event_type: "callout", occurred_at: "2026-08-20T20:06:00.000Z", reason: "Reviewed command test", staff: { first_name: "Ava", last_name: "Lopez" } },
    ]);
    render(<AdminStaffingConsolePageClient {...loadedProps} />);
    await user.selectOptions(screen.getByLabelText(/^staff member$/i), "staff-1");
    fireEvent.change(screen.getByLabelText(/^occurred at \(et\)$/i), { target: { value: "2026-08-20T16:06" } });
    await user.type(screen.getByLabelText(/^reason or note$/i), "  Reviewed command test  ");
    await user.click(screen.getByRole("button", { name: /save attendance event/i }));
    expect(rpcMock).toHaveBeenCalledExactlyOnceWith("haven_employee_file_command", {
      p_staff_id: "staff-1", p_action: "record_attendance",
      p_payload: { event_type: "callout", occurred_at: "2026-08-20T20:06:00.000Z", reason: "Reviewed command test" },
    });
    expect(fromMock).not.toHaveBeenCalled();
    expect(await screen.findByText("Reviewed command test")).toBeInTheDocument();
    expect(reload).toHaveBeenCalledWith(baseFacilityId);
    expect(screen.getByLabelText(/^staff member$/i)).toHaveValue("");
    expect(screen.getByLabelText(/^reason or note$/i)).toHaveValue("");
  });

  it("shows rejected attendance saves without direct-table fallback or a success refresh", async () => {
    const user = userEvent.setup();
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: { message: "Independent manager access required." } });
    const fromMock = vi.fn();
    const reload = vi.spyOn(staffingLoader, "fetchAttendanceEvents");
    mocks.createClientMock.mockReturnValue({ rpc: rpcMock, from: fromMock });
    render(<AdminStaffingConsolePageClient {...loadedProps} />);
    await user.selectOptions(screen.getByLabelText(/^staff member$/i), "staff-1");
    await user.click(screen.getByRole("button", { name: /save attendance event/i }));
    await waitFor(() => expect(screen.getByText("Independent manager access required.")).toBeInTheDocument());
    expect(screen.getByText("Workforce console unavailable")).toBeInTheDocument();
    expect(fromMock).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
