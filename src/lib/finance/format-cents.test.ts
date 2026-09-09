import { describe, expect, it } from "vitest";
import { parseDollarsToCents } from "./format-cents";

describe("HFA-036 exact dollar input", () => {
  it.each([
    ["12.34", 1234], ["1234", 123400], [" $1,234.56 ", 123456],
    [".29", 29], ["0.01", 1], ["12.", 1200], ["12.3", 1230],
    ["-$1,234.56", -123456], ["+12.34", 1234], ["0", 0],
    ["90071992547409.91", Number.MAX_SAFE_INTEGER],
    ["-90071992547409.91", -Number.MAX_SAFE_INTEGER],
  ] as const)("parses %s as exact cents", (input, expected) => {
    expect(parseDollarsToCents(input)).toBe(expected);
  });

  it.each(["1.005", "0.009", "1.999", "1e3", "0x10", "1,2,3", "12,34.56", "1$2", "90071992547409.92", "-90071992547409.92", "", "$", ".", "NaN", "Infinity"])("rejects %s without rounding or reinterpretation", input => {
    expect(parseDollarsToCents(input)).toBeNull();
  });
});
