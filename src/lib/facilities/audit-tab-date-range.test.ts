import { describe, expect, it } from "vitest";

import { auditTabRangeFromPreset } from "@/lib/facilities/audit-tab-date-range";

describe("auditTabRangeFromPreset", () => {
  /** 8:05 PM Eastern on 2026-08-20 — UTC calendar date is already 2026-08-21. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("anchors preset windows to the Eastern facility calendar, not UTC", () => {
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");

    const thirtyDay = auditTabRangeFromPreset("30d", eightOhFivePmEt);
    expect(thirtyDay.to).toBe("2026-08-20");
    expect(thirtyDay.to).not.toBe("2026-08-21");
    expect(thirtyDay.from).toBe("2026-07-21");

    const ytd = auditTabRangeFromPreset("ytd", eightOhFivePmEt);
    expect(ytd.from).toBe("2026-01-01");
    expect(ytd.to).toBe("2026-08-20");
  });

  it("uses a one-day Eastern calendar window for 24h (date-only filter)", () => {
    const range = auditTabRangeFromPreset("24h", eightOhFivePmEt);
    expect(range).toEqual({ from: "2026-08-19", to: "2026-08-20" });
  });
});
