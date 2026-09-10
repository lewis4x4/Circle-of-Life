import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/operations/auth", () => ({
  requireOperationsActor: vi.fn(),
  actorCanAccessFacility: vi.fn(),
}));
const logError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/observability/logger", () => ({ logError }));

import { PATCH } from "./route";
import { actorCanAccessFacility, requireOperationsActor } from "@/lib/operations/auth";

const rpc = vi.fn();
const update = vi.fn();
const lookup = vi.fn();
const single = vi.fn();
const sentinel = "column secret_template_state violates constraint operation_task_templates_policy";
const existingTemplate = {
  id: "template",
  facility_id: null,
  name: "Daily safety review",
  description: "Review all safety controls",
  category: "safety",
  cadence_type: "daily",
  shift_scope: null,
  day_of_week: null,
  day_of_month: null,
  month_of_year: null,
  assignee_role: null,
  required_role_fallback: null,
  escalation_ladder: [],
  asset_ref: null,
  vendor_booking_ref: null,
  linked_document_id: null,
  priority: "normal",
  license_threatening: false,
  compliance_requirement: null,
  survey_readiness_impact: false,
  requires_dual_sign: false,
  estimated_minutes: null,
  auto_complete_after_hours: null,
  is_active: true,
  version: 1,
  previous_version_id: null,
  created_at: "2026-09-06T00:00:00.000Z",
  updated_at: "2026-09-06T00:00:00.000Z",
};
const actor = {
  id: "actor",
  organizationId: "org",
  admin: {
    rpc,
    from: vi.fn(() => {
      const query = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: lookup,
        update: (payload: unknown) => {
          update(payload);
          return query;
        },
        single,
      };
      return query;
    }),
  },
};
Object.assign(actor, { currentActor: { client: actor.admin } });

describe("operation template error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireOperationsActor).mockResolvedValue({ actor } as never);
    lookup.mockResolvedValue({ data: null, error: { message: sentinel } });
    single.mockResolvedValue({ data: null, error: null });
    rpc.mockResolvedValue({ data: null, error: null });
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

  it("does not expose a status update failure", async () => {
    lookup.mockResolvedValue({ data: existingTemplate, error: null });
    single.mockResolvedValue({ data: null, error: { message: sentinel } });

    const response = await PATCH(
      new Request("https://local.test/template", { method: "PATCH", body: JSON.stringify({ is_active: false }) }) as never,
      { params: Promise.resolve({ id: "template" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toEqual({ error: "Failed to update operation template" });
    expect(JSON.stringify(payload)).not.toContain(sentinel);
    expect(logError).toHaveBeenCalledWith(
      "admin.operations.templates.update",
      expect.objectContaining({ message: sentinel }),
      { action: "update-status", templateId: "template" },
    );
  });

  it("rejects a site change on revision before any command runs", async () => {
    vi.mocked(actorCanAccessFacility).mockResolvedValue(true);
    lookup.mockResolvedValue({ data: { ...existingTemplate, facility_id: "site-a" }, error: null });

    const response = await PATCH(
      new Request("https://local.test/template", { method: "PATCH", body: JSON.stringify({ facility_id: "site-b", name: "Moved" }) }) as never,
      { params: Promise.resolve({ id: "template" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "A template keeps its site across revisions. Create a new template at the other site." });
    expect(rpc).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("never forwards caller-supplied stable identity into a revision", async () => {
    lookup.mockResolvedValue({ data: existingTemplate, error: null });
    rpc.mockResolvedValue({ data: { ...existingTemplate, id: "revision", version: 2, name: "Renamed" }, error: null });

    const response = await PATCH(
      new Request("https://local.test/template", {
        method: "PATCH",
        body: JSON.stringify({ name: "Renamed", id: "chosen-id", activity_id: "chosen-activity", previous_version_id: "chosen-parent", version: 9 }),
      }) as never,
      { params: Promise.resolve({ id: "template" }) },
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    const payload = (rpc.mock.calls[0] as unknown[])[1] as { p_previous_id: string; p_payload: Record<string, unknown> };
    expect(payload.p_previous_id).toBe("template");
    expect(payload.p_payload).not.toHaveProperty("id");
    expect(payload.p_payload).not.toHaveProperty("activity_id");
    expect(payload.p_payload).not.toHaveProperty("previous_version_id");
    expect(payload.p_payload).not.toHaveProperty("version");
  });

  it.each([
    ["A newer template version already exists. Reload before editing", "A newer template version already exists. Reload before editing"],
    [sentinel, "Template could not be published. Review the current version and retry."],
  ])("returns the bounded publish conflict for %s", async (databaseMessage, expectedMessage) => {
    lookup.mockResolvedValue({ data: existingTemplate, error: null });
    rpc.mockResolvedValue({ data: null, error: { message: databaseMessage } });

    const response = await PATCH(
      new Request("https://local.test/template", { method: "PATCH", body: JSON.stringify({ name: "Updated safety review" }) }) as never,
      { params: Promise.resolve({ id: "template" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toEqual({ error: expectedMessage });
    expect(logError).toHaveBeenCalledWith(
      "admin.operations.templates.update",
      expect.objectContaining({ message: databaseMessage }),
      { action: "publish-version", templateId: "template" },
    );
  });
});
