import { describe, expect, it } from "vitest";

import { caregiverIllnessSelfReportSuccessCopy } from "./illness-self-report-copy";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";

describe("caregiver illness self-report copy", () => {
  /** 8:05 PM Eastern on 2026-08-20 (EDT, UTC−4) — UTC date is already 2026-08-21. */
  const eightOhFivePmEt = new Date("2026-08-20T20:05:00-04:00");

  it("names the Eastern calendar date after 8pm ET, not the UTC ISO slice", () => {
    expect(todayFacilityDateIso(eightOhFivePmEt)).toBe("2026-08-20");
    expect(eightOhFivePmEt.toISOString().slice(0, 10)).toBe("2026-08-21");

    expect(caregiverIllnessSelfReportSuccessCopy(eightOhFivePmEt)).toBe(
      "Illness self-report saved for 2026-08-20 Eastern. A nurse may follow up.",
    );
  });
});
