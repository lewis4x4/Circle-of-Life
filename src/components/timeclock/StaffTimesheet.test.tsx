import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { StaffTimesheet } from "./StaffTimesheet";

const FACILITY = "00000000-0000-0000-0002-000000000003";
const ORG = "00000000-0000-0000-0000-000000000001";
const STAFF_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const auth = vi.hoisted(() => ({ appRole: "facility_admin", organizationId: "00000000-0000-0000-0000-000000000001" as string | null, user: { id: "user-1" } as { id: string } | null }));
const tables = vi.hoisted(() => ({
  timeclock_organization_settings: [] as Record<string, unknown>[],
  time_punches: [] as Record<string, unknown>[],
  staff: [] as Record<string, unknown>[],
  time_punch_corrections: [] as Record<string, unknown>[],
  timeclock_sync_rejections: [] as Record<string, unknown>[],
  floor_unlocks: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
}));

vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ appRole: auth.appRole, organizationId: auth.organizationId, user: auth.user, loading: false }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("period_start=2026-11-02") }));
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
        insert: async (payload: Record<string, unknown>) => {
          tables.inserts.push(payload);
          tables.time_punch_corrections = [...tables.time_punch_corrections, { id: `c${tables.inserts.length}`, target_punch_id: null, target_correction_id: null, punch_type: null, corrected_punched_at: null, exception_key: null, note: null, corrected_at: "2026-11-05T12:00:00.000Z", ...payload }];
          return { error: null };
        },
        then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return builder;
    },
  }),
}));

const NOW = () => new Date("2026-11-05T16:00:00.000Z");

beforeEach(() => {
  auth.appRole = "facility_admin";
  tables.inserts = [];
  tables.timeclock_organization_settings = [];
  tables.staff = [{ id: STAFF_A, first_name: "Test Staff", last_name: "A", preferred_name: null, employment_status: "active", facility_id: FACILITY }];
  tables.time_punches = [
    { id: "p1", staff_id: STAFF_A, facility_id: FACILITY, punch_type: "in", punched_at: "2026-11-02T12:00:00.000Z", flags: [], captured_offline: false, device_time: "2026-11-02T12:00:00.000Z" },
    // No out on 11-02: missing_out. Next day's in exists.
    { id: "p2", staff_id: STAFF_A, facility_id: FACILITY, punch_type: "in", punched_at: "2026-11-03T12:00:00.000Z", flags: ["offline_capture"], captured_offline: true, device_time: "2026-11-03T12:00:00.000Z" },
    { id: "p3", staff_id: STAFF_A, facility_id: FACILITY, punch_type: "out", punched_at: "2026-11-03T20:00:00.000Z", flags: [], captured_offline: false, device_time: "2026-11-03T20:00:00.000Z" },
  ];
  tables.time_punch_corrections = [];
  tables.timeclock_sync_rejections = [];
});

describe("StaffTimesheet", () => {
  it("renders days, exceptions and the full history for a manager", async () => {
    render(<StaffTimesheet staffId={STAFF_A} now={NOW} />);
    expect(await screen.findByRole("heading", { name: "Test Staff A" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Mon, Nov 2" })).toHaveTextContent("Missing clock out");
    expect(screen.getByRole("article", { name: "Tue, Nov 3" })).toHaveTextContent("8:00 worked");
    expect(screen.getByRole("article", { name: "Tue, Nov 3" })).toHaveTextContent("Captured offline");
    expect(screen.getByText("Full history")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Add a correction" })).toBeInTheDocument();
  });

  it("requires a verified clock-out time instead of acknowledging missing hours", async () => {
    render(<StaffTimesheet staffId={STAFF_A} now={NOW} />);
    await screen.findByRole("heading", { name: "Test Staff A" });
    const missingDay = within(screen.getByRole("article", { name: "Mon, Nov 2" }));
    expect(missingDay.queryByRole("button", { name: "Acknowledge" })).toBeNull();
    fireEvent.click(missingDay.getByRole("button", { name: "Add clock out" }));
    expect(screen.getByLabelText("Punch type")).toHaveValue("out");
    expect(screen.getByLabelText("Reason")).toHaveValue("missed_punch");
    expect(screen.getByLabelText("Punch time (Eastern)")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    expect(tables.inserts).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Punch time (Eastern)"), { target: { value: "2026-11-02T15:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(tables.inserts).toHaveLength(1));
    expect(tables.inserts[0]).toMatchObject({ organization_id: ORG, facility_id: FACILITY, staff_id: STAFF_A, correction_type: "add_punch", punch_type: "out", corrected_punched_at: "2026-11-02T20:00:00.000Z", reason: "missed_punch", corrected_by: "user-1" });
    await waitFor(() => expect(missingDay.queryByText(/Missing clock out/)).toBeNull());
    expect(screen.getByRole("article", { name: "Mon, Nov 2" })).toHaveTextContent("8:00 worked");
  });

  it("still acknowledges a captured-offline review as an appended manager_verified_time row", async () => {
    render(<StaffTimesheet staffId={STAFF_A} now={NOW} />);
    await screen.findByRole("heading", { name: "Test Staff A" });
    fireEvent.click(within(screen.getByRole("article", { name: "Tue, Nov 3" })).getByRole("button", { name: "Acknowledge" }));
    await waitFor(() => expect(tables.inserts).toHaveLength(1));
    expect(tables.inserts[0]).toMatchObject({ correction_type: "acknowledge", exception_key: "offline_capture:p2", reason: "manager_verified_time" });
  });

  it("requires an explicit meal-end time instead of acknowledging an unfinished meal", async () => {
    tables.time_punches = [
      { id: "p1", staff_id: STAFF_A, facility_id: FACILITY, punch_type: "in", punched_at: "2026-11-02T12:00:00Z", flags: [] },
      { id: "meal", staff_id: STAFF_A, facility_id: FACILITY, punch_type: "meal_start", punched_at: "2026-11-02T16:00:00Z", flags: [] },
      { id: "out", staff_id: STAFF_A, facility_id: FACILITY, punch_type: "out", punched_at: "2026-11-02T20:00:00Z", flags: [] },
    ];
    render(<StaffTimesheet staffId={STAFF_A} now={NOW} />);
    await screen.findByRole("heading", { name: "Test Staff A" });
    expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add meal end" }));
    expect(screen.getByLabelText("Punch type")).toHaveValue("meal_end");
    expect(screen.getByLabelText("Punch time (Eastern)")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    expect(tables.inserts).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Punch time (Eastern)"), { target: { value: "2026-11-02T12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(tables.inserts).toHaveLength(1));
    expect(tables.inserts[0]).toMatchObject({ correction_type: "add_punch", punch_type: "meal_end", corrected_punched_at: "2026-11-02T17:00:00.000Z" });
    await waitFor(() => expect(screen.getByRole("article", { name: "Mon, Nov 2" })).toHaveTextContent("7:00 worked"));
  });

  it("keeps a visiting staff member's missing clock-out correction at the worked facility", async () => {
    tables.staff[0]!.facility_id = "home-facility";
    tables.time_punches = [];
    tables.time_punch_corrections = [{ id: "added-in", staff_id: STAFF_A, facility_id: FACILITY, correction_type: "add_punch", punch_type: "in", corrected_punched_at: "2026-11-02T12:00:00Z", corrected_at: "2026-11-02T12:00:00Z", target_punch_id: null, target_correction_id: null, corrected_by: "user-1", reason: "missed_punch", note: null }];
    render(<StaffTimesheet staffId={STAFF_A} now={NOW} />);
    fireEvent.click(await screen.findByRole("button", { name: "Add clock out" }));
    fireEvent.change(screen.getByLabelText("Punch time (Eastern)"), { target: { value: "2026-11-02T15:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(tables.inserts).toHaveLength(1));
    expect(tables.inserts[0]).toMatchObject({ facility_id: FACILITY, correction_type: "add_punch", punch_type: "out" });
  });

  it("adds a missing punch with a required reason, converting the Eastern time to UTC", async () => {
    render(<StaffTimesheet staffId={STAFF_A} now={NOW} />);
    await screen.findByRole("heading", { name: "Test Staff A" });
    fireEvent.change(screen.getByLabelText("Correction"), { target: { value: "add_punch" } });
    fireEvent.change(screen.getByLabelText("Punch type"), { target: { value: "out" } });
    fireEvent.change(screen.getByLabelText("Punch time (Eastern)"), { target: { value: "2026-11-02T15:00" } });
    // Reason is required: the browser blocks the submit before anything is written.
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(tables.inserts).toHaveLength(0);
    expect(screen.getByLabelText("Reason")).toBeRequired();
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "missed_punch" } });
    fireEvent.change(screen.getByLabelText(/Note/), { target: { value: "Forgot to clock out" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(tables.inserts).toHaveLength(1));
    expect(tables.inserts[0]).toMatchObject({ correction_type: "add_punch", punch_type: "out", corrected_punched_at: "2026-11-02T20:00:00.000Z", reason: "missed_punch", note: "Forgot to clock out", corrected_by: "user-1" });
    // The added out closes the 11-02 shift, so the missing_out exception disappears on recompute.
    await waitFor(() => expect(screen.getByRole("article", { name: "Mon, Nov 2" })).not.toHaveTextContent("Missing clock out"));
  });

  it("voids a punch by target id", async () => {
    render(<StaffTimesheet staffId={STAFF_A} now={NOW} />);
    await screen.findByRole("heading", { name: "Test Staff A" });
    fireEvent.change(screen.getByLabelText("Correction"), { target: { value: "void_punch" } });
    fireEvent.change(screen.getByLabelText("Punch"), { target: { value: "p1" } });
    fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "duplicate" } });
    fireEvent.click(screen.getByRole("button", { name: "Save correction" }));
    await waitFor(() => expect(tables.inserts).toHaveLength(1));
    expect(tables.inserts[0]).toMatchObject({ correction_type: "void_punch", target_punch_id: "p1", reason: "duplicate" });
    expect(tables.inserts[0]).not.toHaveProperty("corrected_punched_at");
  });

  it("hides the correction controls from a staff member viewing their own punches", async () => {
    auth.appRole = "caregiver";
    render(<StaffTimesheet staffId={STAFF_A} now={NOW} />);
    await screen.findByRole("heading", { name: "Test Staff A" });
    expect(screen.queryByRole("heading", { name: "Add a correction" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Acknowledge" })).toBeNull();
    expect(screen.getByText("Full history")).toBeInTheDocument();
  });
});
