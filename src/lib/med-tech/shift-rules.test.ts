import { describe, expect, it } from "vitest";

import { canSetFacilityShiftRule, canSetOrganizationShiftRule, medTechShiftRuleAt, type MedTechShiftRule } from "./shift-rules";

const FAC = "00000000-0000-0000-0002-000000000003";
function rule(p: Partial<MedTechShiftRule>): MedTechShiftRule {
  return {
    id: Math.random().toString(36),
    organization_id: "org",
    facility_id: null,
    open_trigger: "clock_in",
    close_trigger: "clock_out",
    effective_from: "2026-09-23T12:00:00Z",
    change_reason: "r",
    created_at: "2026-09-23T12:00:00Z",
    ...p,
  };
}

describe("medTechShiftRuleAt (COL-681)", () => {
  const orgDefault = rule({ id: "org" });
  const override = rule({ id: "fac", facility_id: FAC, open_trigger: "none", effective_from: "2026-09-24T00:00:00Z" });
  const future = rule({ id: "later", facility_id: FAC, open_trigger: "clock_in", effective_from: "2026-10-01T00:00:00Z" });

  it("uses the organization default until a facility override takes effect", () => {
    expect(medTechShiftRuleAt([orgDefault, override, future], FAC, new Date("2026-09-23T18:00:00Z"))?.id).toBe("org");
  });

  it("uses the latest facility override in force, not one scheduled later", () => {
    expect(medTechShiftRuleAt([orgDefault, override, future], FAC, new Date("2026-09-25T00:00:00Z"))?.id).toBe("fac");
    expect(medTechShiftRuleAt([orgDefault, override, future], FAC, new Date("2026-10-02T00:00:00Z"))?.id).toBe("later");
  });

  it("ignores another facility's override and returns null when nothing is in force", () => {
    expect(medTechShiftRuleAt([rule({ facility_id: "other" })], FAC, new Date("2026-09-25T00:00:00Z"))).toBeNull();
  });
});

describe("who may set the rule", () => {
  it("lets owners and org admins set the default, facility admins only their building", () => {
    expect(canSetOrganizationShiftRule("owner")).toBe(true);
    expect(canSetOrganizationShiftRule("facility_admin")).toBe(false);
    expect(canSetFacilityShiftRule("facility_admin")).toBe(true);
    expect(canSetFacilityShiftRule("med_tech")).toBe(false);
  });
});
