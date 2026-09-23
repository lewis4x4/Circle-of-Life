import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), resident: vi.fn() }));
vi.mock("@/lib/caregiver/facility-context", () => ({ loadCaregiverFacilityContext: mocks.context }));

import { CAREGIVER_RESIDENT_OUT_OF_SCOPE_COPY, checkCaregiverResidentScope } from "./resident-scope";

function client() {
  const query: Record<string, unknown> = {};
  for (const name of ["select", "eq", "is"]) query[name] = () => query;
  query.maybeSingle = async () => mocks.resident();
  return { from: () => query } as unknown as Parameters<typeof checkCaregiverResidentScope>[0];
}

beforeEach(() => {
  mocks.context.mockResolvedValue({ ok: true, ctx: { facilityId: "oakridge" } });
});

it("reads a resident hidden by RLS as out of scope, not as a coercion error", async () => {
  mocks.resident.mockResolvedValue({ data: null, error: null });
  expect(await checkCaregiverResidentScope(client(), "r-1")).toEqual({
    ok: false,
    outOfScope: true,
    error: CAREGIVER_RESIDENT_OUT_OF_SCOPE_COPY,
  });
});

it("reads a resident in another working facility as out of scope", async () => {
  mocks.resident.mockResolvedValue({ data: { id: "r-1", facility_id: "homewood" }, error: null });
  const result = await checkCaregiverResidentScope(client(), "r-1");
  expect(result).toMatchObject({ ok: false, outOfScope: true });
});

it("lets an in-scope resident through", async () => {
  mocks.resident.mockResolvedValue({ data: { id: "r-1", facility_id: "oakridge" }, error: null });
  expect(await checkCaregiverResidentScope(client(), "r-1")).toEqual({ ok: true, facilityId: "oakridge" });
});

it("never shows database text when the lookup fails", async () => {
  mocks.resident.mockResolvedValue({ data: null, error: { message: "Cannot coerce the result to a single JSON object", code: "PGRST116" } });
  const result = await checkCaregiverResidentScope(client(), "r-1");
  expect(result).toMatchObject({ ok: false, outOfScope: false });
  expect(JSON.stringify(result)).not.toMatch(/coerce|JSON/);
});
