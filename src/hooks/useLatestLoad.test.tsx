import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useLatestLoad } from "./useLatestLoad";

describe("useLatestLoad (COL-682)", () => {
  it("lets only the most recent read write state", () => {
    const { result } = renderHook(() => useLatestLoad());
    const first = result.current();
    const second = result.current();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("keeps a stable begin function across renders so load callbacks do not churn", () => {
    const { result, rerender } = renderHook(() => useLatestLoad());
    const before = result.current;
    rerender();
    expect(result.current).toBe(before);
  });
});
