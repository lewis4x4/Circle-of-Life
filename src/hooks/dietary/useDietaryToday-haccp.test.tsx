import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  read: vi.fn(),
  selects: [] as { table: string; columns: string; inFilter?: unknown[] }[],
}));
vi.mock("@/lib/caregiver/facility-context", () => ({ loadCaregiverFacilityContext: mocks.context }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "cook" } } }) },
    from: (table: string) => {
      const call: { table: string; columns: string; inFilter?: unknown[] } = { table, columns: "" };
      const query: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const name of ["eq", "order", "limit", "gte", "lte", "neq"]) query[name] = vi.fn(() => query);
      query.select = vi.fn((columns: string) => {
        call.columns = columns;
        mocks.selects.push(call);
        return query;
      });
      query.in = vi.fn((_col: string, vals: unknown[]) => {
        call.inFilter = vals;
        return query;
      });
      query.then = vi.fn((resolve, reject) => Promise.resolve(mocks.read(call)).then(resolve, reject));
      return query;
    },
  }),
}));

import { useDietaryToday } from "./useDietaryToday";

const HACCP_ROW = {
  id: "log-1",
  log_type: "hot_hold",
  item: "Soup",
  temperature_f: 150,
  in_safe_range: true,
  logged_at: "2026-09-22T15:00:00Z",
  logged_by: "user-7",
};

beforeEach(() => {
  mocks.selects.length = 0;
  mocks.context.mockResolvedValue({ ok: true, ctx: { facilityId: "facility-a" } });
});

it("does not embed user_profiles on haccp_logs and resolves the logger's first name by id", async () => {
  mocks.read.mockImplementation((call: { table: string; columns: string }) => {
    if (call.table === "haccp_logs") return { data: [HACCP_ROW], error: null };
    if (call.table === "user_profiles" && call.columns.includes("id"))
      return { data: [{ id: "user-7", full_name: "Maria Lopez" }], error: null };
    return { data: [], error: null };
  });

  const { result } = renderHook(() => useDietaryToday());
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.error).toBeNull();
  const haccpSelect = mocks.selects.find((s) => s.table === "haccp_logs");
  expect(haccpSelect?.columns).not.toMatch(/user_profiles/);
  expect(mocks.selects.find((s) => s.inFilter)?.inFilter).toEqual(["user-7"]);
  expect(result.current.haccp[0]?.logged_by).toBe("Maria");
});

it("keeps the deck up when the logger names cannot be read", async () => {
  mocks.read.mockImplementation((call: { table: string; columns: string }) => {
    if (call.table === "haccp_logs") return { data: [HACCP_ROW], error: null };
    if (call.table === "user_profiles" && call.columns.includes("id"))
      return { data: null, error: { message: "permission denied for table user_profiles" } };
    return { data: [], error: null };
  });

  const { result } = renderHook(() => useDietaryToday());
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.error).toBeNull();
  expect(result.current.haccp[0]?.logged_by).toBe("Staff");
});

it("shows kitchen staff a plain-language message, never the database error", async () => {
  mocks.read.mockImplementation((call: { table: string }) =>
    call.table === "meal_services"
      ? { data: null, error: { message: "Could not find a relationship between 'haccp_logs' and 'user_profiles' in the schema cache" } }
      : { data: [], error: null },
  );

  const { result } = renderHook(() => useDietaryToday());
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.error).toMatch(/Kitchen data is unavailable right now/);
  expect(result.current.error).not.toMatch(/schema cache|relationship|meal_services/);
});

it("passes the working-facility prompt through as written", async () => {
  mocks.context.mockResolvedValue({ ok: false, error: "Choose your working facility in the header before continuing." });
  mocks.read.mockReturnValue({ data: [], error: null });

  const { result } = renderHook(() => useDietaryToday());
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.error).toBe("Choose your working facility in the header before continuing.");
});
