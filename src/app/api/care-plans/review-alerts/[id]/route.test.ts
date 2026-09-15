import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { message: string } | null };

const state = vi.hoisted(() => ({
  alert: null as Record<string, unknown> | null,
  hasAccess: true,
  updates: [] as Record<string, unknown>[],
  inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
}));

function fakeFrom(table: string) {
  const query: Record<string, unknown> = {};
  const chain = () => query;
  let updating = false;
  Object.assign(query, {
    select: chain,
    eq: chain,
    is: chain,
    update: (values: Record<string, unknown>) => {
      updating = true;
      state.updates.push(values);
      return query;
    },
    maybeSingle: async (): Promise<Result> =>
      updating
        ? { data: state.alert ? { id: state.alert.id, status: state.updates.at(-1)?.status } : null, error: null }
        : { data: state.alert, error: null },
    insert: async (values: Record<string, unknown>) => {
      state.inserts.push({ table, values });
      return { error: null };
    },
  });
  return query;
}

vi.mock("@/lib/auth/current-api-actor", () => ({
  requireCurrentApiActor: async () => ({ actor: { id: "nurse-1", organizationId: "org", admin: { from: fakeFrom } } }),
}));
vi.mock("@/lib/supabase/service-role-facility-access", () => ({
  serviceRoleUserHasFacilityAccess: async () => state.hasAccess,
}));
vi.mock("@/lib/observability/logger", () => ({ logError: vi.fn() }));

import { PATCH } from "./route";

const openAlert = {
  id: "alert-1",
  care_plan_id: "plan-1",
  resident_id: "res-1",
  facility_id: "fac-1",
  organization_id: "org",
  trigger_type: "fall_incident",
  status: "open",
};

function call(body: unknown) {
  return PATCH(new Request("https://local.test/alert", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "alert-1" }),
  });
}

describe("PATCH /api/care-plans/review-alerts/[id]", () => {
  beforeEach(() => {
    state.alert = { ...openAlert };
    state.hasAccess = true;
    state.updates = [];
    state.inserts = [];
  });

  it("acknowledges an open alert and records who did", async () => {
    const response = await call({ action: "acknowledge" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: "alert-1", status: "acknowledged" });
    expect(state.updates[0]).toMatchObject({ status: "acknowledged", acknowledged_by: "nurse-1" });
    expect(state.inserts[0].values).toMatchObject({ table_name: "care_plan_review_alerts", action: "UPDATE" });
  });

  it("dismisses only with a reason, and keeps the reason", async () => {
    const refused = await call({ action: "dismiss", notes: "  " });
    expect(refused.status).toBe(400);
    expect(state.updates).toEqual([]);

    const response = await call({ action: "dismiss", notes: "Plan already revised on paper; re-keying this week." });
    expect(response.status).toBe(200);
    expect(state.updates[0]).toMatchObject({ status: "dismissed", resolved_by: "nurse-1", resolution_notes: "Plan already revised on paper; re-keying this week." });
  });

  it("refuses to re-acknowledge an acknowledged alert", async () => {
    state.alert = { ...openAlert, status: "acknowledged" };
    const response = await call({ action: "acknowledge" });
    expect(response.status).toBe(409);
    expect(state.updates).toEqual([]);
  });

  it("is a 403 without facility access and a 404 outside the organization", async () => {
    state.hasAccess = false;
    expect((await call({ action: "acknowledge" })).status).toBe(403);
    state.hasAccess = true;
    state.alert = null;
    expect((await call({ action: "acknowledge" })).status).toBe(404);
  });

  it("rejects unknown actions before touching the database", async () => {
    const response = await call({ action: "resolve" });
    expect(response.status).toBe(400);
    expect(state.updates).toEqual([]);
  });
});
