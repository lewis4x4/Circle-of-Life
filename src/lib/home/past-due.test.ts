import { describe, expect, it } from "vitest";

import { pastDueRuleClause } from "./past-due";

describe("pastDueRuleClause", () => {
  it("names a missing grace period instead of 'plus 0 days' (COL-708)", () => {
    expect(pastDueRuleClause({})).toBe("past the due day plus the grace period");
  });

  it("states the configured grace", () => {
    expect(pastDueRuleClause({ graceDays: 5 })).toBe("past the due day plus 5 days");
    expect(pastDueRuleClause({ graceDays: 1 })).toBe("past the due day plus 1 day");
    expect(pastDueRuleClause({ graceDays: 0 })).toBe("past the due day plus 0 days");
  });
});
