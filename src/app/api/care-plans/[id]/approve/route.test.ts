import { beforeEach, describe, expect, it, vi } from "vitest";

import { CARE_PLAN_AUTHOR_APPROVAL_REFUSED } from "@/lib/care-plans/care-plan-approval-copy";

type Result = { data: unknown; error: { message: string } | null };

const state = vi.hoisted(() => ({
  plan: null as Record<string, unknown> | null,
  updateResult: { data: { id: "plan-1" }, error: null } as Result,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
}));

function fakeFrom(table: string) {
  const query: Record<string, unknown> = {};
  const chain = () => query;
  Object.assign(query, {
    select: chain,
    eq: chain,
    is: chain,
    maybeSingle: async (): Promise<Result> =>
      table === "care_plans" && state.updates.length === 0 ? { data: state.plan, error: null } : state.updateResult,
    update: (values: Record<string, unknown>) => {
      state.updates.push({ table, values });
      return query;
    },
    insert: async (values: Record<string, unknown>) => {
      state.inserts.push({ table, values });
      return { error: null };
    },
  });
  return query;
}

const actor = {
  id: "reviewer-1",
  organizationId: "org",
  fullName: "Reviewer Example",
  email: "reviewer@example.test",
  sessionEmail: null,
  admin: { from: fakeFrom },
};

vi.mock("@/lib/auth/current-api-actor", () => ({
  requireCurrentApiActor: async () => ({ actor }),
  revalidateCurrentApiActor: async () => ({ actor }),
}));
vi.mock("@/lib/supabase/service-role-facility-access", () => ({
  serviceRoleUserHasFacilityAccess: async () => true,
}));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { POST } from "./route";

function call() {
  return POST(
    new Request("https://local.test/approve", { method: "POST", body: JSON.stringify({ signature: "data:image/png;base64,AAAA" }) }),
    { params: Promise.resolve({ id: "plan-1" }) },
  );
}

const draft = {
  id: "plan-1",
  resident_id: "res-1",
  facility_id: "fac-1",
  organization_id: "org",
  status: "draft",
  version: 2,
  effective_date: "2026-09-10",
  created_by: "author-1",
};

describe("POST /api/care-plans/[id]/approve — separation of duties", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.plan = draft;
    state.updateResult = { data: { id: "plan-1" }, error: null };
    state.updates = [];
    state.inserts = [];
  });

  it("refuses the version's author and writes nothing", async () => {
    state.plan = { ...draft, created_by: "reviewer-1" };
    const response = await call();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: CARE_PLAN_AUTHOR_APPROVAL_REFUSED });
    expect(state.updates).toEqual([]);
    expect(state.inserts).toEqual([]);
  });

  it("approves for a different reviewer and touches only care_plans", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(state.updates.map((u) => u.table)).toEqual(["care_plans"]);
    expect(state.updates[0].values).toMatchObject({ status: "active", approved_by: "reviewer-1" });
    expect(state.updates[0].values).not.toHaveProperty("acuity_level");
    expect(state.inserts.map((i) => i.table)).toEqual(["audit_log"]);
  });

  it("still approves a legacy version with no recorded author", async () => {
    state.plan = { ...draft, created_by: null };
    const response = await call();
    expect(response.status).toBe(200);
  });

  it("maps the 393 trigger refusal to the same 409 when the table catches what the route missed", async () => {
    state.updateResult = { data: null, error: { message: `new row violates: ${CARE_PLAN_AUTHOR_APPROVAL_REFUSED}` } };
    const response = await call();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: CARE_PLAN_AUTHOR_APPROVAL_REFUSED });
    expect(logError).not.toHaveBeenCalled();
  });
});
