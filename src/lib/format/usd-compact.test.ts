import { describe, expect, it } from "vitest";

import { formatUsdCompact, usdTone } from "@/lib/format/usd-compact";

describe("formatUsdCompact", () => {
  it("puts a true minus sign before the dollar sign", () => {
    expect(formatUsdCompact(-1_452_000)).toBe("−$1.45M");
    expect(formatUsdCompact(-1_452_000)).not.toContain("$-");
  });

  it("scales to K, M and B", () => {
    expect(formatUsdCompact(950)).toBe("$950");
    expect(formatUsdCompact(12_340)).toBe("$12.3K");
    expect(formatUsdCompact(740_000)).toBe("$740K");
    expect(formatUsdCompact(2_600_000)).toBe("$2.6M");
    expect(formatUsdCompact(1_250_000_000)).toBe("$1.25B");
    expect(formatUsdCompact(0)).toBe("$0");
  });

  it("does not invent a number for non-finite input", () => {
    expect(formatUsdCompact(Number.NaN)).toBe("—");
  });
});

describe("usdTone", () => {
  it("never gives a loss a positive tone", () => {
    expect(usdTone(-1)).toBe("danger");
    expect(usdTone(1)).toBe("success");
    expect(usdTone(0)).toBe("default");
  });
});
