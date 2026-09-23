import { describe, expect, it } from "vitest";

import { formatBenefitsQueueScopeSubtitle } from "./benefits-queue-display-copy";

describe("formatBenefitsQueueScopeSubtitle", () => {
  it("keeps authorized-facilities copy when unscoped", () => {
    expect(formatBenefitsQueueScopeSubtitle(null, "Anon Facility A")).toBe(
      "Showing facilities you are authorized to access.",
    );
    expect(formatBenefitsQueueScopeSubtitle(null, null)).not.toContain("selected facility");
  });

  it("names the facility when scoped", () => {
    expect(
      formatBenefitsQueueScopeSubtitle("11111111-1111-4111-8111-111111111111", "Anon Facility A"),
    ).toBe("Showing Anon Facility A.");
  });

  it("names the gap without selected-facility copy when the name is missing", () => {
    expect(
      formatBenefitsQueueScopeSubtitle("11111111-1111-4111-8111-111111111111", null),
    ).toBe("Showing this facility.");
    expect(
      formatBenefitsQueueScopeSubtitle("11111111-1111-4111-8111-111111111111", "   "),
    ).not.toContain("selected facility");
  });
});
