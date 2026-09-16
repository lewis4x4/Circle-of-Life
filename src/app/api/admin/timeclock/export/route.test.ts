import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mock = vi.hoisted(() => ({
  requireAdminApiActor: vi.fn(),
  requireFacilityAccess: vi.fn(),
  loadOrganizationPayPeriod: vi.fn(),
  loadTimeclockPeriod: vi.fn(),
  loadEmployeeNumbers: vi.fn(),
}));
vi.mock("@/lib/admin/api-auth", () => ({ requireAdminApiActor: mock.requireAdminApiActor, requireFacilityAccess: mock.requireFacilityAccess }));
vi.mock("@/lib/timeclock/load", () => ({ loadOrganizationPayPeriod: mock.loadOrganizationPayPeriod, loadTimeclockPeriod: mock.loadTimeclockPeriod, loadEmployeeNumbers: mock.loadEmployeeNumbers }));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn(), logWarn: vi.fn() }));

import { GET } from "./route";

const FACILITY = "00000000-0000-0000-0002-000000000003";
const STAFF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function actor() {
  return {
    id: "manager-1",
    organization_id: "org-1",
    app_role: "facility_admin",
    client: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Homewood Lodge, ALF" }, error: null }) }) }) }) },
    admin: {},
  };
}

function request(params: string): Request {
  return new Request(`https://haven.example/api/admin/timeclock/export?${params}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.requireAdminApiActor.mockResolvedValue({ actor: actor() });
  mock.requireFacilityAccess.mockResolvedValue({ ok: true });
  mock.loadOrganizationPayPeriod.mockResolvedValue({ timeclock_pay_period: "weekly", timeclock_pay_period_anchor: "2026-01-05" });
  mock.loadEmployeeNumbers.mockResolvedValue(new Map([[STAFF, "A-100"]]));
  mock.loadTimeclockPeriod.mockResolvedValue({
    staff: [{ id: STAFF, name: "Test Staff A", firstName: "Test Staff", lastName: "A", employmentStatus: "active", facilityId: FACILITY }],
    punches: [
      { id: "p1", staff_id: STAFF, facility_id: FACILITY, punch_type: "in", punched_at: "2026-09-07T12:00:00.000Z", flags: ["offline_capture"], captured_offline: true },
      { id: "p2", staff_id: STAFF, facility_id: FACILITY, punch_type: "out", punched_at: "2026-09-07T20:00:00.000Z", flags: [], captured_offline: false },
    ],
    corrections: [],
    rejections: [],
  });
});

describe("GET /api/admin/timeclock/export", () => {
  it("refuses non-managers before any load", async () => {
    mock.requireAdminApiActor.mockResolvedValue({ response: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }) });
    expect((await GET(request(`facility_id=${FACILITY}&period_start=2026-09-07`))).status).toBe(403);
    expect(mock.loadTimeclockPeriod).not.toHaveBeenCalled();
  });

  it("is blocked with 409 while an exception in the period lacks an acknowledgment", async () => {
    const response = await GET(request(`facility_id=${FACILITY}&period_start=2026-09-07`));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "open_exceptions", message: "Resolve 1 exception to export" });
  });

  it("is blocked with 409 while the pay period is unset", async () => {
    mock.loadOrganizationPayPeriod.mockResolvedValue(null);
    const response = await GET(request(`facility_id=${FACILITY}&period_start=2026-09-07`));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("pay_period_unset");
  });

  it("streams the timecard CSV once every exception is acknowledged", async () => {
    mock.loadTimeclockPeriod.mockResolvedValueOnce({
      ...(await mock.loadTimeclockPeriod()),
      corrections: [{ id: "c1", staff_id: STAFF, correction_type: "acknowledge", target_punch_id: null, target_correction_id: null, punch_type: null, corrected_punched_at: null, exception_key: "offline_capture:p1", reason: "manager_verified_time", note: null, corrected_by: "manager-1", corrected_at: "2026-09-08T00:00:00.000Z" }],
    });
    const response = await GET(request(`facility_id=${FACILITY}&period_start=2026-09-07`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="haven-timecard-homewood-lodge-alf-2026-09-07.csv"');
    const text = await response.text();
    expect(text.split("\r\n")[0]).toBe("employee_number,staff_name,period_start,period_end,workweek_start,regular_minutes,overtime_minutes,meal_minutes,exception_count,unapproved_exceptions");
    expect(text).toContain("A-100,Test Staff A,2026-09-07,2026-09-13,2026-09-07,480,0,0,1,0");
  });

  it("rejects a period_start that is not a pay period boundary", async () => {
    const response = await GET(request(`facility_id=${FACILITY}&period_start=2026-09-09`));
    expect(response.status).toBe(400);
  });
});
