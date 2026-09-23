import { describe, expect, it } from "vitest";

import {
  TRAINING_HUB_NO_DATE_COPY,
  TRAINING_HUB_NO_FACILITY_COPY,
  TRAINING_HUB_NO_HOURS_COPY,
  TRAINING_HUB_NO_PDF_COPY,
  TRAINING_HUB_NO_PROGRAM_COPY,
  TRAINING_HUB_NO_SIGNER_COPY,
  TRAINING_HUB_NO_STAFF_COPY,
  formatTrainingHubDate,
  formatTrainingHubDemoCardSubtitle,
  formatTrainingHubFacilityName,
  formatTrainingHubHours,
  formatTrainingHubProgramName,
  formatTrainingHubSignerName,
  formatTrainingHubStaffName,
  resolveTrainingHubFacilityScope,
} from "./training-hub-display-copy";

const EM_DASH = "—";

describe("formatTrainingHubFacilityName", () => {
  it("names a missing facility instead of an em dash", () => {
    expect(formatTrainingHubFacilityName(null)).toBe(TRAINING_HUB_NO_FACILITY_COPY);
    expect(formatTrainingHubFacilityName("")).toBe(TRAINING_HUB_NO_FACILITY_COPY);
    expect(formatTrainingHubFacilityName("   ")).toBe(TRAINING_HUB_NO_FACILITY_COPY);
    expect(formatTrainingHubFacilityName(null)).not.toBe(EM_DASH);
  });

  it("returns a posted facility name", () => {
    expect(formatTrainingHubFacilityName("Oakridge ALF")).toBe("Oakridge ALF");
  });
});

describe("formatTrainingHubProgramName", () => {
  it("names a missing program instead of an em dash", () => {
    expect(formatTrainingHubProgramName(null)).toBe(TRAINING_HUB_NO_PROGRAM_COPY);
    expect(formatTrainingHubProgramName("")).toBe(TRAINING_HUB_NO_PROGRAM_COPY);
    expect(formatTrainingHubProgramName("   ")).toBe(TRAINING_HUB_NO_PROGRAM_COPY);
    expect(formatTrainingHubProgramName(null)).not.toBe(EM_DASH);
  });

  it("returns a posted program name", () => {
    expect(formatTrainingHubProgramName("Medication administration")).toBe(
      "Medication administration",
    );
  });
});

describe("formatTrainingHubStaffName", () => {
  it("names a missing staff join instead of an em dash", () => {
    expect(formatTrainingHubStaffName(null)).toBe(TRAINING_HUB_NO_STAFF_COPY);
    expect(formatTrainingHubStaffName({ first_name: "", last_name: "" })).toBe(
      TRAINING_HUB_NO_STAFF_COPY,
    );
    expect(formatTrainingHubStaffName({ first_name: "  ", last_name: "" })).toBe(
      TRAINING_HUB_NO_STAFF_COPY,
    );
    expect(formatTrainingHubStaffName(null)).not.toBe(EM_DASH);
  });

  it("returns a posted staff name", () => {
    expect(formatTrainingHubStaffName({ first_name: "Alex", last_name: "Rivera" })).toBe(
      "Alex Rivera",
    );
  });
});

describe("formatTrainingHubDate", () => {
  it("names a missing date instead of an em dash", () => {
    expect(formatTrainingHubDate(null)).toBe(TRAINING_HUB_NO_DATE_COPY);
    expect(formatTrainingHubDate("")).toBe(TRAINING_HUB_NO_DATE_COPY);
    expect(formatTrainingHubDate("   ")).toBe(TRAINING_HUB_NO_DATE_COPY);
    expect(formatTrainingHubDate("not-a-date")).toBe(TRAINING_HUB_NO_DATE_COPY);
    expect(formatTrainingHubDate(null)).not.toBe(EM_DASH);
  });

  it("formats a date-only value", () => {
    expect(formatTrainingHubDate("2026-08-15")).toMatch(/Aug/);
    expect(formatTrainingHubDate("2026-08-15")).toMatch(/2026/);
  });

  it("formats a timestamp value", () => {
    expect(formatTrainingHubDate("2026-08-15T14:30:00.000Z")).toMatch(/Aug/);
  });
});

describe("formatTrainingHubHours", () => {
  it("names missing hours instead of an em dash", () => {
    expect(formatTrainingHubHours(null)).toBe(TRAINING_HUB_NO_HOURS_COPY);
    expect(formatTrainingHubHours(undefined)).toBe(TRAINING_HUB_NO_HOURS_COPY);
    expect(formatTrainingHubHours(Number.NaN)).toBe(TRAINING_HUB_NO_HOURS_COPY);
    expect(formatTrainingHubHours(null)).not.toBe(EM_DASH);
  });

  it("keeps a real zero as numeric hours", () => {
    expect(formatTrainingHubHours(0)).toBe("0.00");
  });

  it("formats posted hours to two decimals", () => {
    expect(formatTrainingHubHours(1.5)).toBe("1.50");
    expect(formatTrainingHubHours(2)).toBe("2.00");
  });
});

describe("formatTrainingHubSignerName", () => {
  it("names a missing signer instead of an em dash", () => {
    expect(formatTrainingHubSignerName(null)).toBe(TRAINING_HUB_NO_SIGNER_COPY);
    expect(formatTrainingHubSignerName("")).toBe(TRAINING_HUB_NO_SIGNER_COPY);
    expect(formatTrainingHubSignerName("   ")).toBe(TRAINING_HUB_NO_SIGNER_COPY);
    expect(formatTrainingHubSignerName(null)).not.toBe(EM_DASH);
  });

  it("returns a posted signer name", () => {
    expect(formatTrainingHubSignerName("Supervisor A")).toBe("Supervisor A");
  });
});

describe("training hub PDF copy constant", () => {
  it("names a missing PDF instead of an em dash", () => {
    expect(TRAINING_HUB_NO_PDF_COPY).not.toBe(EM_DASH);
    expect(TRAINING_HUB_NO_PDF_COPY).toMatch(/PDF/i);
  });
});

describe("resolveTrainingHubFacilityScope", () => {
  it("marks org-wide mode even when a name is passed", () => {
    expect(resolveTrainingHubFacilityScope(true, "Anon Facility A")).toEqual({ kind: "org_wide" });
    expect(resolveTrainingHubFacilityScope(true, null)).toEqual({ kind: "org_wide" });
  });

  it("names a posted facility when single-facility mode", () => {
    expect(resolveTrainingHubFacilityScope(false, "Anon Facility A")).toEqual({
      kind: "named",
      name: "Anon Facility A",
    });
  });

  it("marks missing name when scoped without a posted name", () => {
    expect(resolveTrainingHubFacilityScope(false, null)).toEqual({ kind: "missing_name" });
    expect(resolveTrainingHubFacilityScope(false, "   ")).toEqual({ kind: "missing_name" });
  });
});

describe("formatTrainingHubDemoCardSubtitle", () => {
  it("keeps org-wide copy and never says selected facility", () => {
    const subtitle = formatTrainingHubDemoCardSubtitle({ kind: "org_wide" });
    expect(subtitle).toMatch(/accessible facilities/i);
    expect(subtitle).not.toContain("selected facility");
  });

  it("names the facility when scoped", () => {
    expect(
      formatTrainingHubDemoCardSubtitle({ kind: "named", name: "Anon Facility A" }),
    ).toBe("Documented skills demonstrations for Anon Facility A.");
  });

  it("names the gap without selected-facility copy when the name is missing", () => {
    const subtitle = formatTrainingHubDemoCardSubtitle({ kind: "missing_name" });
    expect(subtitle).toBe("Documented skills demonstrations for this facility.");
    expect(subtitle).not.toContain("selected facility");
  });
});
