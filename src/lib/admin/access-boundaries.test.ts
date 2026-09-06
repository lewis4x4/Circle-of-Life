import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), access: vi.fn(), event: vi.fn() }));
vi.mock("@/lib/admin/api-auth", async (original) => ({ ...await original(), requireAdminApiActor: mocks.auth, actorCanAccessFacility: mocks.access }));
vi.mock("@/lib/workflows/workflow-events", () => ({ loadAdmissionCaseWorkflowContext: mocks.context, emitWorkflowEvent: mocks.event }));
import { PATCH } from "@/app/api/admin/workflows/admission-cases/[id]/route";
import { actorCanAccessTargetUser, type AdminApiActor } from "./api-auth";
import { NextRequest } from "next/server";

describe("admission identity boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ actor: { id: "actor", organization_id: "org" } }); });
  it.each([ { facility_id: "other" }, { organization_id: "other" }, { resident_id: "other" }, { updated_by: "other" }, null, [], { status: "invented" } ])("rejects unsafe patch %j before lookup or mutation", async (body) => {
    const response = await PATCH(new NextRequest("http://localhost/api", { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "case" }) });
    expect(response.status).toBe(400);
    expect(mocks.context).not.toHaveBeenCalled();
  });
});

describe("shared facility user lookup", () => {
  it("asks for one matching grant when multiple facilities overlap", async () => {
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "in", "is", "limit"]) query[method] = vi.fn(() => query);
    query.then = vi.fn((resolve) => resolve({ data: [{ facility_id: "a" }, { facility_id: "b" }] }));
    query.maybeSingle = vi.fn(() => Promise.resolve(query.limit.mock.calls.length ? { data: { user_id: "target" }, error: null } : { data: null, error: { message: "multiple rows" } }));
    const actor = { id: "actor", organization_id: "org", app_role: "manager", admin: { from: () => query } } as unknown as AdminApiActor;
    expect(await actorCanAccessTargetUser(actor, "target")).toBe(true);
    expect(query.limit).toHaveBeenCalledWith(1);
  });
});
