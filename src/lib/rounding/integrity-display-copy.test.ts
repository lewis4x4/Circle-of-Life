import { describe, expect, it } from "vitest";

import {
  INTEGRITY_NO_FACILITY_NAME_COPY,
  formatIntegrityNoFlagsEmptyTitle,
  formatIntegrityPageSubtitle,
  resolveIntegrityFacilityScope,
} from "./integrity-display-copy";

describe("resolveIntegrityFacilityScope", () => {
  it("returns unscoped when no facility is selected", () => {
    expect(resolveIntegrityFacilityScope(null, null)).toEqual({ kind: "unscoped" });
  });

  it("returns missing_name when a facility id is selected without a resolved name", () => {
    expect(resolveIntegrityFacilityScope("fac-anon-1", undefined)).toEqual({
      kind: "missing_name",
    });
    expect(resolveIntegrityFacilityScope("fac-anon-1", "   ")).toEqual({
      kind: "missing_name",
    });
  });

  it("returns a named scope when the facility name resolves", () => {
    expect(resolveIntegrityFacilityScope("fac-anon-1", "Anon Facility A")).toEqual({
      kind: "named",
      name: "Anon Facility A",
    });
  });
});

describe("formatIntegrityPageSubtitle", () => {
  it("leaves the facility ask to the page's FacilityGate when unscoped (COL-651)", () => {
    const subtitle = formatIntegrityPageSubtitle({ kind: "unscoped" });
    expect(subtitle).not.toMatch(/select a facility/i);
    expect(subtitle).not.toContain("selected facility");
    expect(subtitle).not.toMatch(/ at selected facility/i);
  });

  it("never interpolates the missing-name gap into an at-facility sentence", () => {
    const subtitle = formatIntegrityPageSubtitle({ kind: "missing_name" });
    expect(subtitle).toContain(INTEGRITY_NO_FACILITY_NAME_COPY);
    expect(subtitle).not.toContain("selected facility");
    expect(subtitle).not.toMatch(/ at /);
  });

  it("uses at-facility copy only when the facility name is resolved", () => {
    expect(
      formatIntegrityPageSubtitle({ kind: "named", name: "Anon Facility A" }),
    ).toBe(
      "Late entries, retroactive documentation, and audit-evidence flags before they become survey findings at Anon Facility A.",
    );
  });
});

describe("formatIntegrityNoFlagsEmptyTitle", () => {
  it("uses at-facility copy only when the facility name is resolved", () => {
    expect(formatIntegrityNoFlagsEmptyTitle({ kind: "named", name: "Anon Facility A" })).toBe(
      "No integrity flags at Anon Facility A",
    );
  });

  it("never fabricates a facility when unscoped", () => {
    const title = formatIntegrityNoFlagsEmptyTitle({ kind: "unscoped" });
    expect(title).toBe("No integrity flags posted");
    expect(title).not.toContain("selected facility");
    expect(title).not.toMatch(/ at selected facility/i);
  });

  it("never interpolates the missing-name gap into an at-facility sentence", () => {
    expect(formatIntegrityNoFlagsEmptyTitle({ kind: "missing_name" })).toBe(
      "No integrity flags posted",
    );
    expect(formatIntegrityNoFlagsEmptyTitle({ kind: "missing_name" })).not.toContain(" at ");
  });
});
