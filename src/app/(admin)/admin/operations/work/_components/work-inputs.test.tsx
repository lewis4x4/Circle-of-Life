import { describe, expect, it } from "vitest";
import { typedValues, displayValues } from "./work-inputs";
const rules = [
  { key: "at", label: "Observed", type: "datetime", required: false },
];
describe("facility-local typed input", () => {
  it("keeps empty optional values empty and converts a chosen local time", () => {
    expect(typedValues(rules, { at: "" }, "America/New_York")).toEqual({});
    expect(
      typedValues(rules, { at: "2026-09-10T09:30" }, "America/New_York"),
    ).toEqual({ at: "2026-09-10T13:30:00.000Z" });
  });
  it("rejects missing dates, invalid calendar dates and nonexistent DST times", () => {
    for (const at of ["T09:00", "2026-02-30T09:00", "2026-03-08T02:30"])
      expect(() => typedValues(rules, { at }, "America/New_York")).toThrow();
  });
  it("preserves exact unchanged receipt instants including microseconds", () => {
    const original = { at: "2026-11-01T06:30:00.123456Z" };
    expect(
      typedValues(
        rules,
        displayValues(rules, original, "America/New_York"),
        "America/New_York",
        original,
      ),
    ).toEqual(original);
  });
});
