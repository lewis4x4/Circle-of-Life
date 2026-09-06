import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/admin/api-auth", () => ({
  requireAdminApiActor: vi.fn(),
  actorCanAccessFacility: vi.fn(),
}));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { PATCH } from "./route";
import { requireAdminApiActor } from "@/lib/admin/api-auth";

const rpc = vi.fn();
const update = vi.fn();
const sentinel = "column secret_template_state violates constraint operation_task_templates_policy";
const actor = {
  id: "actor",
  organization_id: "org",
  admin: {
    rpc,
    from: vi.fn(() => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: sentinel } }),
        update,
      };
      return query;
    }),
  },
};

describe("operation template error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApiActor).mockResolvedValue({ actor } as never);
  });

  it("does not expose a template lookup error or attempt a mutation", async () => {
    const response = await PATCH(
      new Request("https://local.test/template", { method: "PATCH", body: JSON.stringify({ is_active: false }) }) as never,
      { params: Promise.resolve({ id: "template" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Failed to load operation template" });
    expect(JSON.stringify(payload)).not.toContain(sentinel);
    expect(update).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      "admin.operations.templates.update",
      expect.objectContaining({ message: sentinel }),
      { action: "load", templateId: "template" },
    );
  });
});
