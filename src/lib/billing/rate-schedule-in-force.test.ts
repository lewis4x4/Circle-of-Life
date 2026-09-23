import { describe, expect, it } from "vitest";

import {
  resolveBillingRateRule,
  resolveFacilitySchedule,
  scheduleTimelineState,
  type BillingRateRuleRow,
} from "./rate-schedule-in-force";

// Homewood in production on 2026-09-23 (COL-666): the January card closed on
// 2026-04-30, the May card ($4,400 semi-private) runs to 2026-09-30, and the
// October increase ($4,440) starts 2026-10-01.
const homewood = [
  { id: "jan", effectiveDate: "2026-01-01", endDate: "2026-04-30", status: "superseded" },
  { id: "may", effectiveDate: "2026-05-01", endDate: "2026-09-30", status: "superseded" },
  { id: "oct", effectiveDate: "2026-10-01", endDate: null, status: "published" },
];

describe("resolveFacilitySchedule (COL-666)", () => {
  it("names the May card as in force today and October as next, not the open-ended row", () => {
    const resolution = resolveFacilitySchedule(homewood, "2026-09-23", "single_in_force");
    expect(resolution.winner?.id).toBe("may");
    expect(resolution.next?.id).toBe("oct");
    expect(resolution.conflicting).toEqual([]);
  });

  it("switches to the October card on its effective date", () => {
    expect(resolveFacilitySchedule(homewood, "2026-10-01", "single_in_force").winner?.id).toBe("oct");
  });

  it("refuses to pick when two are in force and the rule allows one", () => {
    const overlap = [
      { id: "a", effectiveDate: "2026-01-01", endDate: null, status: "published" },
      { id: "b", effectiveDate: "2026-05-01", endDate: null, status: "published" },
    ];
    const strict = resolveFacilitySchedule(overlap, "2026-09-23", "single_in_force");
    expect(strict.winner).toBeNull();
    expect(strict.conflicting.map((row) => row.id)).toEqual(["b", "a"]);
    expect(resolveFacilitySchedule(overlap, "2026-09-23", "latest_effective_wins").winner?.id).toBe("b");
  });

  it("never treats drafts or rows ended before they began as in force", () => {
    expect(scheduleTimelineState({ id: "d", effectiveDate: "2026-01-01", endDate: null, status: "draft" }, "2026-09-23")).toBe("draft");
    expect(
      scheduleTimelineState({ id: "e", effectiveDate: "2026-05-01", endDate: "2026-04-30", status: "superseded" }, "2026-09-23"),
    ).toBe("never_in_force");
    expect(scheduleTimelineState(homewood[0], "2026-09-23")).toBe("ended");
  });
});

describe("resolveBillingRateRule mirrors haven_billing_rate_rule", () => {
  const org = "org";
  const rule = (patch: Partial<BillingRateRuleRow>): BillingRateRuleRow => ({
    id: "r",
    organization_id: org,
    facility_id: null,
    effective_from: "2026-01-01",
    rate_overlap_rule: "single_in_force",
    payer_split_is_concession: false,
    created_at: "2026-09-23T00:00:00Z",
    ...patch,
  });

  it("defaults to the stricter rule with no row", () => {
    expect(resolveBillingRateRule([], org, "hw", "2026-09-23")).toEqual({
      rateOverlapRule: "single_in_force",
      payerSplitIsConcession: false,
      ruleId: null,
    });
  });

  it("prefers the facility's own row, then the latest effective date", () => {
    const rules = [
      rule({ id: "org-old" }),
      rule({ id: "org-new", effective_from: "2026-06-01", rate_overlap_rule: "latest_effective_wins" }),
      rule({ id: "hw", facility_id: "hw", effective_from: "2026-02-01" }),
      rule({ id: "future", facility_id: "hw", effective_from: "2027-01-01", rate_overlap_rule: "latest_effective_wins" }),
    ];
    expect(resolveBillingRateRule(rules, org, "hw", "2026-09-23").ruleId).toBe("hw");
    expect(resolveBillingRateRule(rules, org, "other", "2026-09-23").ruleId).toBe("org-new");
    expect(resolveBillingRateRule(rules, org, "other", "2026-03-01").ruleId).toBe("org-old");
    expect(resolveBillingRateRule(rules, "another-org", "hw", "2026-09-23").ruleId).toBeNull();
  });
});
