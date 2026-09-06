import { beforeEach, describe, expect, it, vi } from "vitest";

const workflow = vi.hoisted(() => ({
  ensureForm1823Checklist: vi.fn(),
  emitWorkflowEvent: vi.fn(),
  syncLeadToApplicationPending: vi.fn(),
}));
vi.mock("@/lib/workflows/workflow-events", () => workflow);
vi.mock("@/lib/admin/api-auth", () => ({
  requireAdminApiActor: vi.fn(),
  actorCanAccessFacility: vi.fn(),
}));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { POST } from "./route";
import { actorCanAccessFacility, requireAdminApiActor } from "@/lib/admin/api-auth";

const rpc = vi.fn();
const actor = {
  id: "actor",
  organization_id: "org",
  admin: {
    rpc,
    from: vi.fn((table: string) => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue(
          table === "facilities"
            ? { data: { id: "facility", organization_id: "org", timezone: "America/New_York" }, error: null }
            : { data: { id: "resident", facility_id: "facility" }, error: null },
        ),
      };
      return query;
    }),
  },
};

describe("admission creation error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApiActor).mockResolvedValue({ actor } as never);
    vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
  });

  it("logs but does not return unexpected RPC details or run downstream workflow steps", async () => {
    const sentinel = "relation public.admission_cases violates constraint private_create_request_key";
    rpc.mockResolvedValue({ data: null, error: { message: sentinel } });

    const response = await POST(new Request("https://local.test/admission", {
      method: "POST",
      body: JSON.stringify({ facility_id: "facility", resident_id: "resident", create_intent: "draft" }),
    }) as never);
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Failed to create admission case" });
    expect(JSON.stringify(payload)).not.toContain(sentinel);
    expect(workflow.ensureForm1823Checklist).not.toHaveBeenCalled();
    expect(workflow.syncLeadToApplicationPending).not.toHaveBeenCalled();
    expect(workflow.emitWorkflowEvent).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      "admin.workflows.admission.create",
      expect.objectContaining({ message: sentinel }),
      { action: "rpc", facilityId: "facility" },
    );
  });
});
