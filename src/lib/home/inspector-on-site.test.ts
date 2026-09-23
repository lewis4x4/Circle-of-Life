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
    for (const method of ["select", "eq", "is", "order"]) {
      chain[method] = (...args: unknown[]) => {
        calls.push([method, ...args]);
        return chain;
      };
    }
    chain.limit = async () => ({ data: [{ id: "v1", checked_in_at: "2026-10-01T14:12:00Z", visitor_company: "AHCA" }], error: null });
    const from = vi.fn(() => chain);
    const rows = await fetchOpenInspections({ from } as never, "fac-1");
    expect(from).toHaveBeenCalledWith("visitor_log_entries");
    expect(calls).toEqual(
      expect.arrayContaining([
        ["eq", "facility_id", "fac-1"],
        ["eq", "visitor_type", "surveyor_regulator"],
        ["is", "checked_out_at", null],
        ["is", "voided_at", null],
        ["is", "deleted_at", null],
      ]),
    );
    expect(rows).toEqual([{ id: "v1", checkedInAt: "2026-10-01T14:12:00Z", agency: "AHCA" }]);
  });
});
