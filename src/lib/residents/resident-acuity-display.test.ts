import { describe, expect, it } from "vitest";

import {
  RESIDENT_ACUITY_NOT_RECORDED_COPY,
  acuityDisplay,
  isAcuityRecorded,
  parseDocumentedAcuityLevel,
} from "./resident-acuity-display";
import { RESIDENT_ROSTER_NO_ACUITY_COPY } from "./roster-display-copy";

describe("documented acuity display (shared by roster and overview)", () => {
  it("treats a null, blank or unknown stored value as not recorded, never as level 1", () => {
    for (const raw of [null, undefined, "", "   ", "unknown", "LEVEL_9"]) {
      expect(parseDocumentedAcuityLevel(raw)).toBeNull();
      expect(isAcuityRecorded(raw)).toBe(false);
      expect(acuityDisplay(raw)).toEqual({
        level: null,
        label: RESIDENT_ACUITY_NOT_RECORDED_COPY,
        tone: "gap",
      });
    }
  });

  it("reads the three documented levels with their semantic tones", () => {
    expect(acuityDisplay("level_1")).toEqual({ level: 1, label: "Acuity 1", tone: "muted" });
    expect(acuityDisplay("level_2")).toEqual({ level: 2, label: "Acuity 2", tone: "warning" });
    expect(acuityDisplay("level_3")).toEqual({ level: 3, label: "Acuity 3", tone: "danger" });
  });

  it("gives both pages the same wording for the same stored value", () => {
    const overviewChip = acuityDisplay(null).label;
    expect(overviewChip).toBe(RESIDENT_ROSTER_NO_ACUITY_COPY);
    expect(overviewChip).toBe("No acuity posted");
    expect(overviewChip).not.toMatch(/level 1/i);
  });
});
