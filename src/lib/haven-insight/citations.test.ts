import { describe, expect, it } from "vitest";
import { normalizeInsightCitations } from "./citations";
describe("Insight evidence", () => {
  it("preserves governed source labels and internal references", () => {
    expect(normalizeInsightCitations([{ label: "Saved report", href: "/admin/reports/history/run", kind: "report" }])?.[0]).toMatchObject({ label: "Saved report", href: "/admin/reports/history/run", kind: "report" });
  });
  it("keeps labels but drops active or protocol-relative links", () => {
    const rows = normalizeInsightCitations([{ label: "Source", href: "javascript:alert(1)" }, { label: "Source 2", href: "//example.test" }]);
    expect(rows?.every((row) => row.href === undefined)).toBe(true);
  });
});
