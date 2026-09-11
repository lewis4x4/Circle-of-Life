import assert from "node:assert/strict";
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
  organization_id: "org",
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

describe("operation template error boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdminApiActor).mockResolvedValue({ actor } as never);
    lookup.mockResolvedValue({ data: null, error: { message: sentinel } });
    single.mockResolvedValue({ data: null, error: null });
    rpc.mockResolvedValue({ data: null, error: null });
  });

  it("does not expose a template lookup error or attempt a mutation", async () => {
    const response = await PATCH(
      new Request("https://local.test/template", { method: "PATCH", body: JSON.stringify({ is_active: false }) }) as never,
      { params: Promise.resolve({ id: "template" }) },
    );
    assert(response);
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
    assert(response);
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
    assert(response);
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
