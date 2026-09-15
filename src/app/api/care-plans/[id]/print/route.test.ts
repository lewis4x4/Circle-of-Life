import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: { message: string } | null };

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Result | Result[]>,
  hasAccess: true,
}));

/** Chainable, thenable stand-in for one PostgREST query; answers from `state.tables[table]`. */
function fakeQuery(table: string) {
  const answer = (): Result => {
    const entry = state.tables[table];
    if (Array.isArray(entry)) return entry.shift() ?? { data: null, error: null };
    return entry ?? { data: null, error: null };
  };
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: async () => answer(),
    then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(answer()).then(resolve, reject),
  };
  return query;
}

vi.mock("@/lib/auth/current-api-actor", () => ({
  requireCurrentApiActor: async () => ({
    actor: {
      id: "actor",
      organizationId: "org",
      fullName: "Printer Example",
      email: "printer@example.test",
      sessionEmail: null,
      admin: { from: (table: string) => fakeQuery(table) },
    },
  }),
}));
vi.mock("@/lib/supabase/service-role-facility-access", () => ({
  serviceRoleUserHasFacilityAccess: async () => state.hasAccess,
}));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { GET } from "./route";

const plan = {
  id: "plan-1",
  resident_id: "res-1",
  facility_id: "fac-1",
  organization_id: "org",
  version: 2,
  status: "active",
  effective_date: "2026-09-10",
  review_due_date: "2027-09-10",
  notes: null,
  approved_at: "2026-09-12T14:00:00.000Z",
  approved_by: "nurse-1",
  signature_data: "data:image/png;base64,AAAA",
};

function call() {
  return GET(new Request("https://local.test/print") as never, { params: Promise.resolve({ id: "plan-1" }) });
}

describe("GET /api/care-plans/[id]/print", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.hasAccess = true;
    state.tables = {
      care_plans: { data: plan, error: null },
      residents: {
        data: { id: "res-1", first_name: "Test", last_name: "Resident", date_of_birth: "1940-01-02", beds: [] },
        error: null,
      },
      facilities: {
        data: { name: "Homewood Lodge", address_line_1: "430 Mills St", address_line_2: null, city: "Mayo", state: "FL", zip: "32066", phone: null, license_number: null },
        error: null,
      },
      care_plan_items: {
        data: [{ id: "i1", category: "bathing", title: "Bathing", description: "Assist", assistance_level: "limited_assist", frequency: null, goal: null, interventions: null, special_instructions: null, sort_order: 0 }],
        error: null,
      },
      user_profiles: { data: { full_name: "Nurse Example", email: "nurse@example.test" }, error: null },
    };
  });

  it("returns the packet with the signature block and the printing actor", async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const packet = await response.json();
    expect(packet.plan).toMatchObject({ id: "plan-1", version: 2, status: "active", supersededByVersion: null });
    expect(packet.resident.name).toBe("Test Resident");
    expect(packet.facility.addressLines).toEqual(["430 Mills St", "Mayo, FL 32066"]);
    expect(packet.sections).toHaveLength(1);
    expect(packet.signature).toEqual({
      approvedAt: "2026-09-12T14:00:00.000Z",
      approverName: "Nurse Example",
      signatureData: "data:image/png;base64,AAAA",
    });
    expect(packet.printedBy).toBe("Printer Example");
  });

  it("is a 404 when the plan is not in the actor's organization", async () => {
    state.tables.care_plans = { data: null, error: null };
    const response = await call();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Care plan not found" });
  });

  it("is a 403 when the actor has no access to the plan's facility", async () => {
    state.hasAccess = false;
    const response = await call();
    expect(response.status).toBe(403);
  });

  it("names the superseding version for an archived plan", async () => {
    // Second care_plans answer is the successor lookup.
    state.tables.care_plans = [
      { data: { ...plan, status: "archived" }, error: null },
      { data: { version: 3 }, error: null },
    ];
    const packet = await (await call()).json();
    expect(packet.plan.status).toBe("archived");
    expect(packet.plan.supersededByVersion).toBe(3);
  });

  it("logs and hides a load failure instead of returning query details", async () => {
    const sentinel = "permission denied for relation care_plan_items";
    state.tables.care_plan_items = { data: null, error: { message: sentinel } };
    const response = await call();
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(sentinel);
    expect(logError).toHaveBeenCalledWith(
      "care-plans.print",
      expect.objectContaining({ message: sentinel }),
      { action: "load_packet", carePlanId: "plan-1" },
    );
  });
});
