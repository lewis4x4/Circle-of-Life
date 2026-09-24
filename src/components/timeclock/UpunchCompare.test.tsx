import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UpunchCompare } from "./UpunchCompare";

const FACILITY = "00000000-0000-0000-0002-000000000003";
const STAFF_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const auth = vi.hoisted(() => ({ appRole: "facility_admin" }));
const tables = vi.hoisted(() => ({
  timeclock_organization_settings: [{ timeclock_pay_period: "weekly", timeclock_pay_period_anchor: "2026-01-05" }] as Record<string, unknown>[],
  time_punches: [] as Record<string, unknown>[],
  staff: [] as Record<string, unknown>[],
  time_punch_corrections: [] as Record<string, unknown>[],
  timeclock_sync_rejections: [] as Record<string, unknown>[],
  floor_unlocks: [] as Record<string, unknown>[],
}));
const download = vi.hoisted(() => ({ triggerCsvDownload: vi.fn() }));

vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ appRole: auth.appRole, organizationId: "org-1", user: { id: "user-1" }, loading: false }) }));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: () => ({ selectedFacilityId: FACILITY, availableFacilities: [] }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("period_start=2026-11-02") }));
vi.mock("@/lib/csv-export", async (original) => ({ ...(await original<typeof import("@/lib/csv-export")>()), triggerCsvDownload: download.triggerCsvDownload }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    rpc: async () => ({ data: [{ staff_id: STAFF_A, employee_number: "A-100" }], error: null }),
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
        then: (resolve: (value: { data: unknown; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return builder;
    },
  }),
}));

const NOW = () => new Date("2026-11-10T12:00:00.000Z");

beforeEach(() => {
  auth.appRole = "facility_admin";
  download.triggerCsvDownload.mockClear();
  tables.staff = [{ id: STAFF_A, first_name: "Test Staff", last_name: "A", preferred_name: null, employment_status: "active", facility_id: FACILITY }];
  tables.time_punches = [
    { id: "p1", staff_id: STAFF_A, facility_id: FACILITY, punch_type: "in", punched_at: "2026-11-02T12:00:00.000Z", flags: [], captured_offline: false },
    { id: "p2", staff_id: STAFF_A, facility_id: FACILITY, punch_type: "out", punched_at: "2026-11-02T20:00:00.000Z", flags: [], captured_offline: false },
  ];
});

describe("UpunchCompare", () => {
  it("parses an uploaded uPunch CSV in the browser, maps columns, compares per workweek and downloads the result", async () => {
    const csv = "Employee #,Date,Total Hours\nA-100,11/02/2026,8.05\nZ-9,11/02/2026,4.00\n";
    render(<UpunchCompare now={NOW} readFile={async () => csv} />);
    const input = await screen.findByLabelText("CSV file");
    const file = new File([csv], "upunch.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText("upunch.csv, 2 rows");
    expect((screen.getByLabelText("Employee column") as HTMLSelectElement).value).toBe("Employee #");
    expect((screen.getByLabelText("Hours column") as HTMLSelectElement).value).toBe("Total Hours");
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    const table = await screen.findByRole("table");
    const row = table.querySelector("tbody tr")!;
    expect(row).toHaveTextContent("Test Staff A");
    expect(row).toHaveTextContent("8:00");
    expect(row).toHaveTextContent("8:03");
    expect(row).toHaveTextContent("-3 min");
    expect(row).toHaveTextContent("Match");
    expect(screen.getByRole("heading", { name: /1 of 1 staff weeks match within 5 minutes, 1 uploaded employee not found in Haven/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Download comparison CSV" }));
    await waitFor(() => expect(download.triggerCsvDownload).toHaveBeenCalledTimes(1));
    const [name, text] = download.triggerCsvDownload.mock.calls[0] as [string, string];
    expect(name).toBe("haven-upunch-comparison-2026-11-02.csv");
    expect(text).toContain("A-100,Test Staff A,2026-11-02,480,483,-3,Match");
  });

  it("keeps the upload out of the network: no fetch or insert is made with file contents", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<UpunchCompare now={NOW} readFile={async () => "Employee #,Date,Total Hours\nA-100,11/02/2026,8.00\n"} />);
    const input = await screen.findByLabelText("CSV file");
    fireEvent.change(input, { target: { files: [new File(["x"], "u.csv")] } });
    await screen.findByText("u.csv, 1 rows");
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    await screen.findByRole("table");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
