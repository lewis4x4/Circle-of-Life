import { describe, expect, it } from "vitest";

import {
  isValidExpiringSoonDays,
  resolveCertificationPolicy,
  type CertificationRequirementRule,
  type CertificationRules,
  type CertificationSettingsRule,
} from "./certification-policy";

const ORG = "org";
const F1 = "facility-1";
const F2 = "facility-2";
const AT = new Date("2026-09-23T12:00:00Z");

let n = 0;
function req(p: Partial<CertificationRequirementRule>): CertificationRequirementRule {
  n += 1;
  return {
    id: `r${n}`,
    organization_id: ORG,
    facility_id: null,
    staff_role: "medication_tech",
    certification_type: "bls_cpr",
    required: true,
    effective_from: "2026-09-01T00:00:00Z",
    change_reason: "test",
    created_at: "2026-09-01T00:00:00Z",
    ...p,
  };
}
function win(p: Partial<CertificationSettingsRule>): CertificationSettingsRule {
  n += 1;
  return {
    id: `s${n}`,
    organization_id: ORG,
    facility_id: null,
    expiring_soon_days: 60,
    effective_from: "2026-09-01T00:00:00Z",
    change_reason: "test",
    created_at: "2026-09-01T00:00:00Z",
    ...p,
  };
}
const rules = (requirements: CertificationRequirementRule[], settings: CertificationSettingsRule[] = []): CertificationRules => ({
  requirements,
  settings,
});

describe("resolveCertificationPolicy (COL-709, COL-710)", () => {
  it("is not configured when nothing was ever recorded", () => {
    const policy = resolveCertificationPolicy(rules([], [win({})]), F1, AT);
    expect(policy.configured).toBe(false);
    expect(policy.expiringSoonDays).toBe(60);
  });

  it("applies the organization default to every building", () => {
    const policy = resolveCertificationPolicy(rules([req({})]), F1, AT);
    expect(policy.configured).toBe(true);
    expect([...(policy.requiredTypesByRole.get("medication_tech") ?? [])]).toEqual(["bls_cpr"]);
    expect(policy.requiredTypesByRole.has("owner")).toBe(false);
  });

  it("lets a facility override drop a default requirement for that building only", () => {
    const r = rules([req({}), req({ facility_id: F1, required: false, effective_from: "2026-09-10T00:00:00Z" })]);
    expect(resolveCertificationPolicy(r, F1, AT).requiredTypesByRole.has("medication_tech")).toBe(false);
    expect(resolveCertificationPolicy(r, F1, AT).configured).toBe(true);
    expect(resolveCertificationPolicy(r, F2, AT).requiredTypesByRole.has("medication_tech")).toBe(true);
  });

  it("resolves as of its own time: a future row is not yet in force, a newer row replaces an older one", () => {
    const r = rules([
      req({}),
      req({ required: false, effective_from: "2026-09-20T00:00:00Z" }),
      req({ required: true, effective_from: "2026-10-01T00:00:00Z" }),
    ]);
    expect(resolveCertificationPolicy(r, F1, AT).requiredTypesByRole.has("medication_tech")).toBe(false);
    expect(resolveCertificationPolicy(r, F1, new Date("2026-10-02T00:00:00Z")).requiredTypesByRole.has("medication_tech")).toBe(true);
  });

  it("takes the building's window over the organization's", () => {
    const r = rules([], [win({}), win({ facility_id: F1, expiring_soon_days: 30, effective_from: "2026-09-10T00:00:00Z" })]);
    expect(resolveCertificationPolicy(r, F1, AT).expiringSoonDays).toBe(30);
    expect(resolveCertificationPolicy(r, F2, AT).expiringSoonDays).toBe(60);
    expect(resolveCertificationPolicy(r, null, AT).expiringSoonDays).toBe(60);
  });

  it("has no window when none is set, rather than inventing one", () => {
    expect(resolveCertificationPolicy(rules([]), F1, AT).expiringSoonDays).toBeNull();
  });
});

describe("isValidExpiringSoonDays", () => {
  it("keeps the window within a week and a year", () => {
    expect(isValidExpiringSoonDays(7)).toBe(true);
    expect(isValidExpiringSoonDays(365)).toBe(true);
    expect(isValidExpiringSoonDays(6)).toBe(false);
    expect(isValidExpiringSoonDays(366)).toBe(false);
    expect(isValidExpiringSoonDays(30.5)).toBe(false);
  });
});
