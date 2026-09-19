import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), access: vi.fn() }));
vi.mock("@/lib/rounding/auth", () => ({
  getRoundingRequestContext: mocks.context,
  assertRoundingFacilityAccess: mocks.access,
  isRoundingManagerRole: () => false,
}));
vi.mock("@/lib/rounding/board-policy-fetch", () => ({
  fetchObservationBoardPolicy: async () => null,
  ObservationBoardPolicyMissing: class extends Error {},
}));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));
import { GET } from "./route";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

const history = Array.from({ length: 1050 }, (_, index) => ({
  id: `past-${index}`, status: "completed_on_time", service_date: "2020-01-01",
  assigned_staff_id: "staff", facility_id: "f", organization_id: "org", resident_id: "r", deleted_at: null,
}));
const current = { ...history[0], id: "current", status: "due_now", service_date: todayFacilityDateIso() };
const foreign = { ...current, id: "foreign", assigned_staff_id: "other" };
function install(rows: typeof history) {
  mocks.context.mockResolvedValue({ context: {
    appRole: "caregiver", currentStaffId: "staff", organizationId: "org",
    admin: { from: () => {
      let filtered = rows; let from = 0; let to = 999;
      const query = {
        select: () => query, order: () => query,
        eq: (key: string, value: unknown) => { filtered = filtered.filter(row => row[key as keyof typeof row] === value); return query; },
        is: (key: string, value: unknown) => query.eq(key, value),
        or: () => { filtered = filtered.filter(row => !["completed_on_time", "completed_late", "excused"].includes(row.status) || row.service_date === todayFacilityDateIso()); return query; },
        limit: (count: number) => { to = count - 1; return query; },
        range: (start: number, end: number) => { from = start; to = Math.min(end, start + 136); return query; },
        then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: filtered.slice(from, to + 1), count: filtered.length, error: null }).then(resolve),
      }; return query;
    } },
  } });
}
beforeEach(() => { mocks.access.mockResolvedValue(true); });
it("loads a linked current task after years of completed history, preserving caregiver scope", async () => {
  install([...history, current, foreign]);
  const result = await GET(new Request("https://haven.test/api/rounding/tasks?facilityId=f&residentId=r&taskId=current"));
  expect((await result.json()).tasks.map((row: { id: string }) => row.id)).toEqual(["current"]);
  const denied = await GET(new Request("https://haven.test/api/rounding/tasks?facilityId=f&taskId=foreign"));
  expect((await denied.json()).tasks).toEqual([]);
});
it("loads every pending queue entry through a lower server cap without letting old completed rows starve it", async () => {
  const pending = Array.from({ length: 1007 }, (_, index) => ({ ...current, id: `pending-${index}` }));
  install([...history, ...pending, foreign]);
  const result = await GET(new Request("https://haven.test/api/rounding/tasks?facilityId=f&queue=1"));
  expect((await result.json()).tasks.map((row: { id: string }) => row.id)).toEqual(pending.map(row => row.id));
});
