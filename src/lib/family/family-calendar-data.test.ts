import { describe, expect, it } from "vitest";

import { getFamilyCalendarDateWindow } from "@/lib/family/family-calendar-data";

describe("family calendar date window (America/New_York)", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("anchors the query window on the Eastern calendar, not UTC ISO slice", () => {
    const { from, to } = getFamilyCalendarDateWindow(eightOhFivePmEt);

    expect(from).toBe("2026-08-13");
    expect(to).toBe("2026-12-18");
    expect(from).not.toBe("2026-08-14");
    expect(to).not.toBe("2026-12-19");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });
});
