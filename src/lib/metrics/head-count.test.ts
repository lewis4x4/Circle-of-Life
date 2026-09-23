import { describe, expect, it } from "vitest";

import { describeCountTile, headCountOrNull, requireHeadCount } from "./head-count";

describe("headCountOrNull", () => {
  it("is null, not 0, when the count failed or was not returned", () => {
    expect(headCountOrNull({ count: null, error: { message: "permission denied" } })).toBeNull();
    expect(headCountOrNull({ count: null, error: null })).toBeNull();
    expect(headCountOrNull({})).toBeNull();
  });

  it("keeps a real zero", () => {
    expect(headCountOrNull({ count: 0, error: null })).toBe(0);
  });
});

describe("requireHeadCount", () => {
  it("throws instead of reading a failed count as 0", () => {
    expect(() => requireHeadCount({ count: null, error: { message: "boom" } }, "Open incidents")).toThrow(
      "Open incidents count failed: boom",
    );
    expect(() => requireHeadCount({ count: null }, "Census")).toThrow("Census count was not returned");
  });

  it("returns the count, including zero", () => {
    expect(requireHeadCount({ count: 0 }, "Census")).toBe(0);
    expect(requireHeadCount({ count: 7 }, "Census")).toBe(7);
  });
});

describe("describeCountTile", () => {
  const copy = { positive: "Awaiting action", zero: "All processed" };

  it("never shows the zero copy for a missing count", () => {
    expect(describeCountTile(null, true, copy)).toEqual({ subLabel: "Count unavailable", attention: false });
  });

  it("shows loading until ready", () => {
    expect(describeCountTile(3, false, copy).subLabel).toBe("Loading count…");
  });

  it("flags a positive count and keeps a real zero", () => {
    expect(describeCountTile(3, true, copy)).toEqual({ subLabel: "Awaiting action", attention: true });
    expect(describeCountTile(0, true, copy)).toEqual({ subLabel: "All processed", attention: false });
  });
});
