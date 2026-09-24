import { describe, expect, it, vi } from "vitest";

import { fetchOpenInspections, openInspectionLine } from "@/lib/home/inspector-on-site";

const NY = "America/New_York";

describe("openInspectionLine (COL-692)", () => {
  it("names the agency and the time for one inspector", () => {
    expect(openInspectionLine([{ id: "a", checkedInAt: "2026-10-01T14:12:00Z", agency: "AHCA" }], NY)).toBe(
      "An inspector from AHCA signed in at the front door at 10:12 AM.",
    );
    expect(openInspectionLine([{ id: "a", checkedInAt: "2026-10-01T14:12:00Z", agency: null }], NY)).toBe(
      "An inspector signed in at the front door at 10:12 AM.",
    );
  });

  it("counts several and names the first arrival", () => {
    const rows = [
      { id: "a", checkedInAt: "2026-10-01T13:48:00Z", agency: "AHCA" },
      { id: "b", checkedInAt: "2026-10-01T14:12:00Z", agency: "Fire marshal" },
    ];
    expect(openInspectionLine(rows, NY)).toBe("2 inspectors or officials are in the building. The first signed in at 9:48 AM.");
  });

  it("says nothing when nobody is open", () => {
    expect(openInspectionLine([], NY)).toBeNull();
  });
});

describe("fetchOpenInspections", () => {
  it("asks only for open, unvoided inspector visits at the facility", async () => {
    const calls: [string, ...unknown[]][] = [];
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is", "gte", "order"]) {
      chain[method] = (...args: unknown[]) => {
        calls.push([method, ...args]);
        return chain;
      };
    }
    chain.limit = async () => ({ data: [{ id: "v1", checked_in_at: "2026-10-01T14:12:00Z", visitor_company: "AHCA" }], error: null });
    const from = vi.fn(() => chain);
    const rows = await fetchOpenInspections({ from } as never, "fac-1", new Date("2026-10-01T15:00:00Z"));
    expect(from).toHaveBeenCalledWith("visitor_log_entries");
    expect(calls).toEqual(
      expect.arrayContaining([
        ["eq", "facility_id", "fac-1"],
        ["eq", "visitor_type", "surveyor_regulator"],
        ["is", "checked_out_at", null],
        ["is", "voided_at", null],
        ["is", "deleted_at", null],
        // 04:00 EDT on October 1: an inspector left open from yesterday no longer raises the banner.
        ["gte", "checked_in_at", "2026-10-01T08:00:00.000Z"],
      ]),
    );
    expect(rows).toEqual([{ id: "v1", checkedInAt: "2026-10-01T14:12:00Z", agency: "AHCA" }]);
  });
});

describe("visitorLeftOpenThresholdIso (spec 38 left-open rule)", () => {
  it("is today's 04:00 Eastern after 04:00, and yesterday's before it, across DST", async () => {
    const { visitorLeftOpenThresholdIso } = await import("@/lib/registers/register-display-copy");
    expect(visitorLeftOpenThresholdIso(new Date("2026-10-01T15:00:00Z"))).toBe("2026-10-01T08:00:00.000Z");
    expect(visitorLeftOpenThresholdIso(new Date("2026-10-01T07:59:00Z"))).toBe("2026-09-30T08:00:00.000Z");
    expect(visitorLeftOpenThresholdIso(new Date("2026-01-15T12:00:00Z"))).toBe("2026-01-15T09:00:00.000Z");
    // Clocks go back 2026-11-01 at 02:00: 04:00 EST that morning is 09:00 UTC.
    expect(visitorLeftOpenThresholdIso(new Date("2026-11-01T10:00:00Z"))).toBe("2026-11-01T09:00:00.000Z");
    // Clocks go forward 2026-03-08 at 02:00: 04:00 EDT that morning is 08:00 UTC.
    expect(visitorLeftOpenThresholdIso(new Date("2026-03-08T08:30:00Z"))).toBe("2026-03-08T08:00:00.000Z");
  });
});
