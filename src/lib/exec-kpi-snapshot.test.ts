import { describe, expect, it } from "vitest";

import {
  EXECUTIVE_LIVE_MISSED_RATE_NOT_COMPUTED_COPY,
  formatExecutiveLiveMissedRate,
  getExecutiveKpiDateWindow,
} from "@/lib/exec-kpi-snapshot";

describe("getExecutiveKpiDateWindow (Eastern wall clock)", () => {
  /** 8:05 PM Eastern on 2026-08-24 (EDT, UTC−4) — UTC calendar day is already tomorrow. */
  const eightOhFivePmEtAug24 = new Date("2026-08-24T20:05:00-04:00");

  it("keeps today on the Eastern calendar after 8pm ET, not UTC ISO slice", () => {
    const window = getExecutiveKpiDateWindow(eightOhFivePmEtAug24);

    expect(window.today).toBe("2026-08-24");
    expect(window.today).not.toBe("2026-08-25");
    expect(eightOhFivePmEtAug24.toISOString().slice(0, 10)).toBe("2026-08-25");
  });

  it("offsets +30 on the Eastern calendar after 8pm ET", () => {
    const window = getExecutiveKpiDateWindow(eightOhFivePmEtAug24);

    expect(window.plus30).toBe("2026-09-23");
  });

  it("anchors MTD start to Eastern month, not UTC month", () => {
    const window = getExecutiveKpiDateWindow(eightOhFivePmEtAug24);

    expect(window.mtdStart).toBe("2026-08-01");
  });

  /** 8:05 PM Eastern on 2026-01-31 (EST) — UTC month is February. */
  const eightOhFivePmEtJan31 = new Date("2026-01-31T20:05:00-05:00");

  it("uses Eastern start-of-month when UTC has rolled to the next month", () => {
    const window = getExecutiveKpiDateWindow(eightOhFivePmEtJan31);

    expect(window.today).toBe("2026-01-31");
    expect(window.mtdStart).toBe("2026-01-01");
    expect(window.mtdStart).not.toBe("2026-02-01");
  });
});

describe("formatExecutiveLiveMissedRate", () => {
  it("names the live-load gap instead of showing a fabricated zero", () => {
    expect(formatExecutiveLiveMissedRate(null)).toBe(EXECUTIVE_LIVE_MISSED_RATE_NOT_COMPUTED_COPY);
    expect(formatExecutiveLiveMissedRate(0)).toBe("0%");
    expect(formatExecutiveLiveMissedRate(0.125)).toBe("13%");
  });
});
