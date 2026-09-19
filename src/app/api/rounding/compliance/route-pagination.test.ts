import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("@/lib/rounding/auth", () => ({
  getRoundingRequestContext: mocks.context,
  assertRoundingFacilityAccess: async () => true,
  isRoundingManagerRole: () => true,
}));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));
import { GET } from "./route";
it("includes unsatisfied tail windows after the hosted response cap", async () => {
  const rows = Array.from({ length: 1007 }, (_, index) => ({
    resident_id: `r-${index}`, service_date: "2026-09-18", window_key: "meal", shift_key: "day",
    task_id: null, task_status: null, satisfied: index < 1000, absorbed: false, expectation_source: "cadence",
  }));
  function query(all: unknown[]) {
    let from = 0; let to = 999;
    const builder = {
      select: () => builder, eq: () => builder, is: () => builder,
      gte: () => builder, lte: () => builder, order: () => builder, limit: () => builder,
      range: (start: number, end: number) => { from = start; to = Math.min(end, start + 136); return builder; },
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: all.slice(from, to + 1), count: all.length, error: null }).then(resolve),
    }; return builder;
  }
  mocks.context.mockResolvedValue({ context: {
    appRole: "administrator", actor: { client: { rpc: () => query(rows), from: () => query([]) } },
  } });
  const response = await GET(new Request("https://haven.test/api/rounding/compliance?facilityId=f&from=2026-09-18&to=2026-09-18"));
  expect(response.status).toBe(200);
  expect((await response.json()).totals).toMatchObject({ expected: 1007, satisfied: 1000 });
});
