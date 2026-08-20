import { describe, expect, it } from "vitest";

import {
  facilityDatetimeLocalToUtcIso,
  utcIsoToFacilityDatetimeLocal,
} from "@/lib/facility-wall-clock";

describe("referral tour datetime-local (America/New_York)", () => {
  /** 4:06 PM Eastern on 2026-08-20 (EDT, UTC−4). */
  const fourOhSixPmEtUtc = "2026-08-20T20:06:00.000Z";

  it("hydrates tour datetime-local from stored UTC in Eastern wall clock, not UTC ISO slice", () => {
    expect(utcIsoToFacilityDatetimeLocal(fourOhSixPmEtUtc)).toBe("2026-08-20T16:06");
    expect(utcIsoToFacilityDatetimeLocal(fourOhSixPmEtUtc)).not.toBe("2026-08-20T20:06");
    expect(new Date(fourOhSixPmEtUtc).toISOString().slice(0, 16)).toBe("2026-08-20T20:06");
  });

  it("persists tour datetime-local to UTC without a 4-hour shift", () => {
    expect(facilityDatetimeLocalToUtcIso("2026-08-20T16:06")).toBe(fourOhSixPmEtUtc);
  });
});
