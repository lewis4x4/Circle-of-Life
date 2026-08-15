import { describe, expect, it } from "vitest";

import {
  TRAINING_HUB_NO_FACILITY_COPY,
  TRAINING_HUB_NO_PROGRAM_COPY,
  formatTrainingHubFacilityName,
  formatTrainingHubProgramName,
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
