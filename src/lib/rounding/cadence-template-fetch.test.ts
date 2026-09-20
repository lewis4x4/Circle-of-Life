import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyObservationTemplate } from "./cadence-template-fetch";

describe("template application contract", () => {
  it("pins the reviewed immutable revision and sends each facility's timing independently", async () => {
    const rpc = vi.fn().mockImplementation((_name, args) => Promise.resolve({ data: { facilities: [{ facility_id: args.p_facility_ids[0], ok: args.p_facility_ids[0] !== "restricted", reason: "Access denied" }] }, error: null }));
    const client = { rpc } as unknown as SupabaseClient;
    const args = { templateId: "template", expectedVersionId: "reviewed-version", kind: "cadence" as const, reason: "Coverage", acknowledgment: "Standard" };
    const success = await applyObservationTemplate(client, { ...args, facilityId: "one", applyMode: "next_shift_boundary", effectiveFrom: null });
    const failure = await applyObservationTemplate(client, { ...args, facilityId: "restricted", applyMode: "scheduled", effectiveFrom: "2026-09-22T10:00:00Z" });
    expect(success.ok).toBe(true);
    expect(failure).toMatchObject({ facility_id: "restricted", ok: false });
    expect(rpc).toHaveBeenNthCalledWith(2, "apply_template_to_facilities", expect.objectContaining({ p_facility_ids: ["restricted"], p_apply_mode: "scheduled", p_effective_from: "2026-09-22T10:00:00Z", p_expected_cadence_template_version_id: "reviewed-version", p_expected_escalation_template_version_id: null }));
  });
  it("does not turn a missing per-facility outcome into success", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: { facilities: [] }, error: null }) } as unknown as SupabaseClient;
    await expect(applyObservationTemplate(client, { facilityId: "one", templateId: "t", expectedVersionId: "v", kind: "escalation", reason: "Coverage", acknowledgment: "Standard", applyMode: "immediate", effectiveFrom: null })).rejects.toThrow("No result");
  });
});
