import { describe, expect, it } from "vitest";

import { headCountOrNull, requireHeadCount } from "./require-head-count";

describe("head counts (COL-649)", () => {
  it("keeps a real zero", () => {
    expect(requireHeadCount({ count: 0, error: null }, "Census")).toBe(0);
    expect(headCountOrNull({ count: 0, error: null })).toBe(0);
  });

  it("never turns a failed or missing count into 0", () => {
    expect(headCountOrNull({ count: null, error: { message: "403" } })).toBeNull();
    expect(headCountOrNull({ count: null, error: null })).toBeNull();
    expect(() => requireHeadCount({ count: null, error: null }, "Census")).toThrow(/Census count unavailable/);
    expect(() => requireHeadCount({ count: 5, error: { message: "boom" } }, "Census")).toThrow(/Census count failed/);
  });

  it("rethrows an Error as-is", () => {
    const err = new Error("permission denied");
    expect(() => requireHeadCount({ count: null, error: err }, "Census")).toThrow(err);
  });
});
