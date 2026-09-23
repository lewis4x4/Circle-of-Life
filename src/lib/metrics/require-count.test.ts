import { describe, expect, it } from "vitest";

import { requireCount } from "./require-count";

describe("requireCount", () => {
  it("returns a real count, including a real zero", () => {
    expect(requireCount({ count: 0 }, "residents")).toBe(0);
    expect(requireCount({ count: 12, error: null }, "residents")).toBe(12);
  });

  it("throws the query error rather than returning 0", () => {
    const error = { message: "column does not exist" };
    expect(() => requireCount({ count: null, error }, "residents")).toThrow();
  });

  it("throws when the count is missing without an error", () => {
    expect(() => requireCount({ count: null }, "residents")).toThrow(/residents: count missing/);
    expect(() => requireCount({ count: undefined }, "residents")).toThrow();
  });
});
