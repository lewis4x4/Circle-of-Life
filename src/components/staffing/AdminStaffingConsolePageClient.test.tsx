import { render, screen } from "@testing-library/react";
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
});
