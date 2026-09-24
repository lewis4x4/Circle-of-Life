import { describe, expect, it } from "vitest";

import {
  manualChangedSinceSigning,
  resolveOnboardingManualPolicy,
  summarizeOnboardingManuals,
  withOnboardingManuals,
  type OnboardingManualRule,
  type OnboardingManualStatus,
} from "./onboarding-manuals";

const row = (over: Partial<OnboardingManualStatus> = {}): OnboardingManualStatus => ({
  document_id: "doc-1",
  document_title: "Resident Rights P&P",
  required_from: "2026-09-24T12:00:00Z",
  signoff_id: null,
  signed_at: null,
  signature_name: null,
  method: null,
  signed_content_sha256: null,
  current_content_sha256: "a".repeat(64),
  ...over,
});
const signed = (over: Partial<OnboardingManualStatus> = {}) =>
  row({ signoff_id: "s-1", signed_at: "2026-09-25T12:00:00Z", signature_name: "New Hire", method: "self", signed_content_sha256: "a".repeat(64), ...over });

describe("summarizeOnboardingManuals", () => {
  it("owes nothing when no rule applies (existing staff, unconfigured roles)", () => {
    expect(summarizeOnboardingManuals([])).toEqual({ state: "none_required" });
  });

  it("counts what is still unsigned", () => {
    const summary = summarizeOnboardingManuals([signed(), row({ document_id: "doc-2" })]);
    expect(summary).toMatchObject({ state: "outstanding", required: 2, signed: 1 });
  });

  it("is all signed only when every required manual has a sign-off", () => {
    expect(summarizeOnboardingManuals([signed()])).toEqual({ state: "all_signed", required: 1 });
  });
});

describe("withOnboardingManuals", () => {
  const ready = { status: "ready" as const, reasons: [] };

  it("blocks a hire who has not signed a required manual", () => {
    expect(withOnboardingManuals(ready, [row()])).toEqual({ status: "blocked", reasons: ["Resident Rights P&P: not signed"] });
  });

  it("does not treat a failed or pending read as signed", () => {
    expect(withOnboardingManuals(ready, null).status).toBe("blocked");
    expect(withOnboardingManuals(ready, undefined).status).toBe("blocked");
  });

  it("leaves readiness alone when nothing is owed or everything is signed", () => {
    expect(withOnboardingManuals(ready, [])).toBe(ready);
    expect(withOnboardingManuals(ready, [signed()])).toBe(ready);
  });

  it("adds the manuals to an existing block without hiding its reasons", () => {
    const blocked = { status: "blocked" as const, reasons: ["Employment has not started."] };
    expect(withOnboardingManuals(blocked, [row()]).reasons).toEqual(["Employment has not started.", "Resident Rights P&P: not signed"]);
  });
});

describe("manualChangedSinceSigning", () => {
  it("notes a revision after signing without asking for a new signature", () => {
    expect(manualChangedSinceSigning(signed({ current_content_sha256: "b".repeat(64) }))).toBe(true);
    expect(manualChangedSinceSigning(signed())).toBe(false);
    expect(manualChangedSinceSigning(row())).toBe(false);
  });
});

describe("resolveOnboardingManualPolicy", () => {
  const rule = (over: Partial<OnboardingManualRule>): OnboardingManualRule => ({
    id: Math.random().toString(36),
    organization_id: "org",
    facility_id: null,
    staff_role: "medication_tech",
    document_id: "doc-1",
    required: true,
    effective_from: "2026-09-24T12:00:00Z",
    change_reason: "COL-740",
    created_at: "2026-09-24T12:00:00Z",
    ...over,
  });
  const at = new Date("2026-10-01T12:00:00Z");

  it("is not configured before any rule exists", () => {
    expect(resolveOnboardingManualPolicy([], "homewood", at).configured).toBe(false);
  });

  it("requires the manual for the configured role only", () => {
    const policy = resolveOnboardingManualPolicy([rule({})], "homewood", at);
    expect([...(policy.manualsByRole.get("medication_tech") ?? [])]).toEqual(["doc-1"]);
    expect(policy.manualsByRole.has("housekeeping")).toBe(false);
  });

  it("lets a facility rule override the organization default", () => {
    const rules = [rule({}), rule({ facility_id: "homewood", required: false, effective_from: "2026-09-25T12:00:00Z" })];
    expect(resolveOnboardingManualPolicy(rules, "homewood", at).manualsByRole.size).toBe(0);
    expect(resolveOnboardingManualPolicy(rules, "oakridge", at).manualsByRole.get("medication_tech")?.has("doc-1")).toBe(true);
  });

  it("follows the effective date: a later required=false drops it, a future rule is not yet in force", () => {
    const dropped = [rule({}), rule({ required: false, effective_from: "2026-09-30T12:00:00Z" })];
    expect(resolveOnboardingManualPolicy(dropped, null, at).manualsByRole.size).toBe(0);
    const future = [rule({ effective_from: "2026-12-01T12:00:00Z" })];
    expect(resolveOnboardingManualPolicy(future, null, at).configured).toBe(false);
  });
});
