import { describe, expect, it } from "vitest";

import {
  defaultRoundingReportLast7Days,
  roundingReportRangeForPreset,
} from "./rounding-reports-date-range";

describe("rounding report date presets (America/New_York)", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("anchors last 7 days on the Eastern calendar, not UTC ISO slice", () => {
    const range = defaultRoundingReportLast7Days(eightOhFivePmEt);
    expect(range.to).toBe("2026-08-20");
    expect(range.from).toBe("2026-08-14");
    expect(range.to).not.toBe("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("anchors last 30 days on the Eastern calendar", () => {
    const range = roundingReportRangeForPreset("last_30", eightOhFivePmEt);
    expect(range.to).toBe("2026-08-20");
    expect(range.from).toBe("2026-07-22");
  });

  it("anchors this month on the Eastern calendar", () => {
    const range = roundingReportRangeForPreset("this_month", eightOhFivePmEt);
    expect(range.from).toBe("2026-08-01");
    expect(range.to).toBe("2026-08-20");
  });

  it("anchors last month on the Eastern calendar", () => {
    const range = roundingReportRangeForPreset("last_month", eightOhFivePmEt);
    expect(range.from).toBe("2026-07-01");
    expect(range.to).toBe("2026-07-31");
  });

  it("anchors quarter to date on the Eastern calendar", () => {
    const range = roundingReportRangeForPreset("quarter_to_date", eightOhFivePmEt);
    expect(range.from).toBe("2026-07-01");
    expect(range.to).toBe("2026-08-20");
  });
});
