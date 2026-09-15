import { beforeEach, describe, expect, it, vi } from "vitest";

import { CARE_PLAN_ACK_ONLY_ACTIVE_COPY, CARE_PLAN_ACK_SIGNATURE_REQUIRED_COPY } from "@/lib/care-plans/care-plan-acknowledgement-copy";

const state = vi.hoisted(() => ({
  plan: null as Record<string, unknown> | null,
  hasAccess: true,
  inserts: [] as Record<string, unknown>[],
}));

function fakeFrom(table: string) {
  const query: Record<string, unknown> = {};
  const chain = () => query;
  let inserted: Record<string, unknown> | null = null;
  Object.assign(query, {
    select: chain,
    eq: chain,
    is: chain,
    insert: (values: Record<string, unknown>) => {
      inserted = values;
      state.inserts.push({ table, ...values });
      return query;
    },
    maybeSingle: async () =>
      inserted ? { data: { id: "ack-1", ...inserted }, error: null } : { data: state.plan, error: null },
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

import { POST } from "./route";

const activePlan = { id: "plan-1", resident_id: "res-1", facility_id: "fac-1", organization_id: "org", status: "active" };
const valid = { signer_role: "responsible_party", signer_name: "Alice Example", relationship_to_resident: "daughter", method: "paper_on_file" };

function call(body: unknown) {
  return POST(new Request("https://local.test/ack", { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "plan-1" }),
  });
}

describe("POST /api/care-plans/[id]/acknowledgements", () => {
  beforeEach(() => {
    state.plan = { ...activePlan };
    state.hasAccess = true;
    state.inserts = [];
  });

  it("records an acknowledgement against the active plan with the recording actor", async () => {
    const response = await call(valid);
    expect(response.status).toBe(201);
    expect(state.inserts[0]).toMatchObject({
      table: "care_plan_acknowledgements",
      care_plan_id: "plan-1",
      resident_id: "res-1",
      signer_role: "responsible_party",
      signer_name: "Alice Example",
      method: "paper_on_file",
      signature_data: null,
      recorded_by: "nurse-1",
    });
  });

  it("refuses a draft plan", async () => {
    state.plan = { ...activePlan, status: "draft" };
    const response = await call(valid);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: CARE_PLAN_ACK_ONLY_ACTIVE_COPY });
    expect(state.inserts).toEqual([]);
  });

  it("needs a signature image for an in-person acknowledgement and keeps it", async () => {
    const refused = await call({ ...valid, method: "in_person_signature" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: CARE_PLAN_ACK_SIGNATURE_REQUIRED_COPY });

    const response = await call({ ...valid, method: "in_person_signature", signature_data: "data:image/png;base64,AAAA" });
    expect(response.status).toBe(201);
    expect(state.inserts[0]).toMatchObject({ method: "in_person_signature", signature_data: "data:image/png;base64,AAAA" });
  });

  it("drops a signature that was sent with a non-signature method", async () => {
    const response = await call({ ...valid, method: "verbal_review", signature_data: "data:image/png;base64,AAAA" });
    expect(response.status).toBe(201);
    expect(state.inserts[0]).toMatchObject({ method: "verbal_review", signature_data: null });
  });

  it("rejects unknown roles, unknown methods, and a missing name before any lookup", async () => {
    expect((await call({ ...valid, signer_role: "nurse" })).status).toBe(400);
    expect((await call({ ...valid, method: "emailed" })).status).toBe(400);
    expect((await call({ ...valid, signer_name: " " })).status).toBe(400);
    expect(state.inserts).toEqual([]);
  });

  it("is a 403 without facility access and a 404 outside the organization", async () => {
    state.hasAccess = false;
    expect((await call(valid)).status).toBe(403);
    state.hasAccess = true;
    state.plan = null;
    expect((await call(valid)).status).toBe(404);
  });
});
