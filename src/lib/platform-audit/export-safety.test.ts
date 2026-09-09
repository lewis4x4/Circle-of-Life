import { describe, expect, it } from "vitest";
import { csvEscapeCell } from "../csv-export";
describe("HFA-059 shared CSV export cell safety", () => {
  it.each(["=1+1", "+123", "-123", "@SUM(A1)", "\tformula", "\rformula"])("neutralizes spreadsheet formula prefix %j", (value) => {
    expect(csvEscapeCell(value).replace(/^"/, "").startsWith("'")).toBe(true);
  });
  it("escapes quotes, commas and newlines without losing evidence bytes", () => {
    expect(csvEscapeCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(csvEscapeCell("safe record")).toBe("safe record");
  });
});
