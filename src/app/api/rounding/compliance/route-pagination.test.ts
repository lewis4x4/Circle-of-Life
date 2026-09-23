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

it("reads the range one service date per call so no statement spans the whole range", async () => {
  const calls: Array<{ p_from: string; p_to: string }> = [];
  function query(all: unknown[]) {
    const builder = {
      select: () => builder, eq: () => builder, is: () => builder,
      gte: () => builder, lte: () => builder, order: () => builder, limit: () => builder,
      range: () => builder,
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: all, count: all.length, error: null }).then(resolve),
    }; return builder;
  }
  const row = (day: string) => ({
    resident_id: "r-1", service_date: day, window_key: "meal", shift_key: "day",
    task_id: null, task_status: null, satisfied: true, absorbed: false, expectation_source: "cadence",
  });
  mocks.context.mockResolvedValue({ context: {
    appRole: "administrator",
    actor: { client: {
      rpc: (_name: string, args: { p_from: string; p_to: string }) => { calls.push(args); return query([row(args.p_from)]); },
      from: () => query([]),
    } },
  } });
  const response = await GET(new Request("https://haven.test/api/rounding/compliance?facilityId=f&from=2026-09-16&to=2026-09-22"));
  expect(response.status).toBe(200);
  expect(calls.map((c) => [c.p_from, c.p_to])).toEqual(
    ["16", "17", "18", "19", "20", "21", "22"].map((d) => [`2026-09-${d}`, `2026-09-${d}`]),
  );
  expect((await response.json()).totals).toMatchObject({ expected: 7, satisfied: 7 });
});

it("answers 500 when any one day fails, never a partial range", async () => {
  function query(result: { data: unknown[] | null; count: number | null; error: { message: string } | null }) {
    const builder = {
      select: () => builder, eq: () => builder, is: () => builder,
      gte: () => builder, lte: () => builder, order: () => builder, limit: () => builder,
      range: () => builder,
      then: (resolve: (r: unknown) => unknown) => Promise.resolve(result).then(resolve),
    }; return builder;
  }
  mocks.context.mockResolvedValue({ context: {
    appRole: "administrator",
    actor: { client: {
      rpc: (_name: string, args: { p_from: string }) => args.p_from === "2026-09-18"
        ? query({ data: null, count: null, error: { message: "canceling statement due to statement timeout" } })
        : query({ data: [], count: 0, error: null }),
      from: () => query({ data: [], count: 0, error: null }),
    } },
  } });
  const response = await GET(new Request("https://haven.test/api/rounding/compliance?facilityId=f&from=2026-09-16&to=2026-09-22"));
  expect(response.status).toBe(500);
});
