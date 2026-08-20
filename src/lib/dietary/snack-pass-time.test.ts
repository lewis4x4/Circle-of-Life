import { describe, expect, it } from "vitest";

import {
  formatSnackPassLoggedAtEt,
  nowSnackPassDatetimeLocal,
  snackPassDatetimeLocalToUtcIso,
  SNACK_PASS_FACILITY_TZ,
} from "@/lib/dietary/snack-pass-time";

describe("snack pass facility-local time (America/New_York)", () => {
  /** 10:07 AM Eastern on 2026-08-20 (EDT, UTC−4). */
  const tenOhSevenEt = new Date("2026-08-20T14:07:00.000Z");

  it("defaults pass time to Eastern wall clock, not UTC ISO slice", () => {
    expect(nowSnackPassDatetimeLocal(tenOhSevenEt)).toBe("2026-08-20T10:07");
    expect(nowSnackPassDatetimeLocal(tenOhSevenEt)).not.toBe("2026-08-20T14:07");
    expect(tenOhSevenEt.toISOString().slice(0, 16)).toBe("2026-08-20T14:07");
  });

  it("persists Eastern datetime-local without a 4-hour shift", () => {
    expect(snackPassDatetimeLocalToUtcIso("2026-08-20T10:07")).toBe("2026-08-20T14:07:00.000Z");
  });

  it("formats logged snack passes in Eastern with ET-friendly copy", () => {
    expect(formatSnackPassLoggedAtEt("2026-08-20T14:07:00.000Z")).toMatch(/Aug 20.*10:07/i);
  });

  it("anchors to COL facility timezone constant", () => {
    expect(SNACK_PASS_FACILITY_TZ).toBe("America/New_York");
  });
});
