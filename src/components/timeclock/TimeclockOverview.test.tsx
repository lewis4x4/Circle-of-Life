import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TIMECLOCK_MANAGER_ONLY, TIMECLOCK_PAY_PERIOD_UNSET } from "@/lib/timeclock/display-copy";

import { TimeclockOverview } from "./TimeclockOverview";

const FACILITY = "00000000-0000-0000-0002-000000000003";
const ORG = "00000000-0000-0000-0000-000000000001";
const STAFF_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STAFF_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const auth = vi.hoisted(() => ({ appRole: "owner", organizationId: "00000000-0000-0000-0000-000000000001" as string | null, user: { id: "user-1" } as { id: string } | null }));
const tables = vi.hoisted(() => ({
  timeclock_organization_settings: [] as Record<string, unknown>[],
  time_punches: [] as Record<string, unknown>[],
  staff: [] as Record<string, unknown>[],
  time_punch_corrections: [] as Record<string, unknown>[],
  timeclock_sync_rejections: [] as Record<string, unknown>[],
  floor_unlocks: [] as Record<string, unknown>[],
  upserts: [] as Record<string, unknown>[],
}));

vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ appRole: auth.appRole, organizationId: auth.organizationId, user: auth.user, loading: false }) }));
const scope = vi.hoisted(() => ({ selectedFacilityId: "00000000-0000-0000-0002-000000000003" as string | null }));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: () => ({ selectedFacilityId: scope.selectedFacilityId, availableFacilities: [{ id: FACILITY, name: "Synthetic facility 0003" }] }) }));
vi.mock("@/components/common/FacilityGate", () => ({
  FacilityGateNotice: ({ reason }: { reason: string }) => <div data-testid="facility-gate">{reason}</div>,
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: (table: keyof typeof tables) => {
      const rows = tables[table] as Record<string, unknown>[];
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        is: () => builder,
        gte: () => builder,
        lt: () => builder,
        order: () => builder,
        limit: () => builder,
        range: (start: number, end: number) => Promise.resolve({ data: rows.slice(start, end + 1), count: rows.length, error: null }),
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        upsert: async (payload: Record<string, unknown>) => {
          tables.upserts.push(payload);
          return { error: null };
        },
        then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return builder;
    },
  }),
}));

const NOW = () => new Date("2026-11-04T16:00:00.000Z"); // Wednesday 11:00 a.m. Eastern, week of 2026-11-02

beforeEach(() => {
  auth.appRole = "owner";
  scope.selectedFacilityId = FACILITY;
  tables.timeclock_organization_settings = [];
  tables.upserts = [];
  tables.staff = [
    { id: STAFF_A, first_name: "Test Staff", last_name: "A", preferred_name: null, employment_status: "active", facility_id: FACILITY },
    { id: STAFF_B, first_name: "Test Staff", last_name: "B", preferred_name: null, employment_status: "active", facility_id: FACILITY },
  ];
  tables.time_punches = [
    { id: "p1", staff_id: STAFF_A, facility_id: FACILITY, punch_type: "in", punched_at: "2026-11-04T11:58:00.000Z", flags: [], captured_offline: false },
    { id: "p2", staff_id: STAFF_B, facility_id: FACILITY, punch_type: "in", punched_at: "2026-11-02T12:00:00.000Z", flags: ["clock_skew"], captured_offline: false },
    { id: "p3", staff_id: STAFF_B, facility_id: FACILITY, punch_type: "out", punched_at: "2026-11-02T20:00:00.000Z", flags: [], captured_offline: false },
  ];
  tables.time_punch_corrections = [];
  tables.timeclock_sync_rejections = [];
});

describe("TimeclockOverview", () => {
  it("under All facilities shows the shared facility gate, not a pointer to the top bar (COL-651)", async () => {
    scope.selectedFacilityId = null;
    render(<TimeclockOverview now={NOW} />);
    expect(await screen.findByTestId("facility-gate")).toHaveTextContent(/one facility at a time/i);
    expect(screen.queryByText(/top bar/i)).not.toBeInTheDocument();
  });

  it("shows the manager-only notice for a caregiver", async () => {
    auth.appRole = "caregiver";
    render(<TimeclockOverview now={NOW} />);
    expect(await screen.findByText(TIMECLOCK_MANAGER_ONLY)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("lists staff with status now, period minutes, overtime and exception counts, and blocks export until the pay period is set", async () => {
    render(<TimeclockOverview now={NOW} />);
    const table = await screen.findByRole("table");
    expect(table).toBeInTheDocument();
    const rowA = screen.getByRole("link", { name: "Test Staff A" }).closest("tr")!;
    expect(rowA).toHaveTextContent("In since 6:58 a.m.");
    const rowB = screen.getByRole("link", { name: "Test Staff B" }).closest("tr")!;
    expect(rowB).toHaveTextContent("Out");
    expect(rowB).toHaveTextContent("8:00");
    expect(rowB).toHaveTextContent("1"); // one unacknowledged clock_skew
    expect(screen.getByRole("button", { name: "Export payroll CSV" })).toBeDisabled();
    expect(screen.getByText(TIMECLOCK_PAY_PERIOD_UNSET)).toBeInTheDocument();
    expect(screen.getByTestId("period-label")).toHaveTextContent("Nov 2, 2026 to Nov 8, 2026 (one week, pay period not set)");
    // The unset frequency is not pre-filled as Biweekly over a one-week view (COL-659).
    expect(screen.getByLabelText("Frequency")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("Anchor Monday"), { target: { value: "2026-10-26" } });
    expect(screen.getByRole("button", { name: "Save pay period" })).toBeDisabled();
  });

  it("lets an owner set the pay period, then blocks export on open exceptions", async () => {
    render(<TimeclockOverview now={NOW} />);
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("Frequency"), { target: { value: "biweekly" } });
    fireEvent.change(screen.getByLabelText("Anchor Monday"), { target: { value: "2026-10-26" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pay period" }));
    await waitFor(() => expect(tables.upserts).toHaveLength(1));
    expect(tables.upserts[0]).toMatchObject({ organization_id: ORG, timeclock_pay_period: "biweekly", timeclock_pay_period_anchor: "2026-10-26", updated_by: "user-1" });
    await waitFor(() => expect(screen.getByTestId("period-label")).toHaveTextContent("Oct 26, 2026 to Nov 8, 2026"));
    expect(screen.getByRole("button", { name: "Export payroll CSV" })).toBeDisabled();
    expect(screen.getByText("Resolve 1 exception to export")).toBeInTheDocument();
  });

  it("enables the export link once the pay period is set and every exception is acknowledged", async () => {
    tables.timeclock_organization_settings = [{ timeclock_pay_period: "weekly", timeclock_pay_period_anchor: "2026-01-05" }];
    tables.time_punch_corrections = [
      { id: "c1", staff_id: STAFF_B, correction_type: "acknowledge", target_punch_id: null, target_correction_id: null, punch_type: null, corrected_punched_at: null, exception_key: "clock_skew:p2", reason: "manager_verified_time", note: null, corrected_by: "user-1", corrected_at: "2026-11-03T12:00:00.000Z" },
    ];
    render(<TimeclockOverview now={NOW} />);
    await screen.findByRole("table");
    const link = await screen.findByRole("link", { name: "Export payroll CSV" });
    expect(link).toHaveAttribute("href", `/api/admin/timeclock/export?facility_id=${FACILITY}&period_start=2026-11-02`);
    expect(screen.queryByText(/Resolve .* to export/)).toBeNull();
  });
});
