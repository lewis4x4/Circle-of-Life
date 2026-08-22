import { describe, expect, it } from "vitest";

import {
  classifyStaffCertification,
  getFacilityStaffKpiDateWindow,
  isBackgroundCheckExpiringWithin30Days,
} from "./facility-staff-kpi-classification";

describe("facility staff KPI date windows (America/New_York)", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — after the UTC date rolls to tomorrow. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("anchors today and +30 on the Eastern calendar, not UTC ISO slice", () => {
    const { today, plus30 } = getFacilityStaffKpiDateWindow(eightOhFivePmEt);
    expect(today).toBe("2026-08-20");
    expect(plus30).toBe("2026-09-19");
    expect(today).not.toBe("2026-08-21");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");
  });

  it("classifies a cert expiring today as expiring after 8pm ET", () => {
    expect(classifyStaffCertification("2026-08-20", "active", eightOhFivePmEt)).toBe("expiring");
  });

  it("classifies a cert expiring tomorrow as expiring within the 30-day window", () => {
    expect(classifyStaffCertification("2026-08-21", "active", eightOhFivePmEt)).toBe("expiring");
  });

  it("classifies a cert that lapsed yesterday as expired", () => {
    expect(classifyStaffCertification("2026-08-19", "active", eightOhFivePmEt)).toBe("expired");
  });

  it("keeps a cert beyond the 30-day window as current", () => {
    expect(classifyStaffCertification("2026-10-01", "active", eightOhFivePmEt)).toBe("current");
  });

  it("counts a background check expiring today in the <30-day window after 8pm ET", () => {
    expect(isBackgroundCheckExpiringWithin30Days("2026-08-20T23:59:59.000Z", eightOhFivePmEt)).toBe(true);
  });

  it("excludes a background check that already lapsed", () => {
    expect(isBackgroundCheckExpiringWithin30Days("2026-08-19", eightOhFivePmEt)).toBe(false);
  });

  it("excludes a background check beyond the 30-day window", () => {
    expect(isBackgroundCheckExpiringWithin30Days("2026-09-20", eightOhFivePmEt)).toBe(false);
  });
});
