import { describe, expect, it } from "vitest";

import {
  V2_THRESHOLDS_NO_FACILITY_POSTED_COPY,
  formatV2ThresholdFacilityName,
} from "./v2-thresholds-display-copy";

const EM_DASH = "—";

describe("formatV2ThresholdFacilityName", () => {
  it("names the gap when facility name is missing", () => {
    expect(formatV2ThresholdFacilityName(null)).toBe(V2_THRESHOLDS_NO_FACILITY_POSTED_COPY);
    expect(formatV2ThresholdFacilityName(undefined)).toBe(V2_THRESHOLDS_NO_FACILITY_POSTED_COPY);
    expect(formatV2ThresholdFacilityName(null)).not.toBe(EM_DASH);
  });

  it("names the gap when facility name is blank", () => {
    expect(formatV2ThresholdFacilityName("")).toBe(V2_THRESHOLDS_NO_FACILITY_POSTED_COPY);
    expect(formatV2ThresholdFacilityName("   ")).toBe(V2_THRESHOLDS_NO_FACILITY_POSTED_COPY);
    expect(formatV2ThresholdFacilityName("")).not.toBe(EM_DASH);
  });

  it("names the gap when facility name is an em dash", () => {
    expect(formatV2ThresholdFacilityName(EM_DASH)).toBe(V2_THRESHOLDS_NO_FACILITY_POSTED_COPY);
    expect(formatV2ThresholdFacilityName(`  ${EM_DASH}  `)).toBe(
      V2_THRESHOLDS_NO_FACILITY_POSTED_COPY,
    );
    expect(formatV2ThresholdFacilityName(EM_DASH)).not.toBe(EM_DASH);
  });

  it("keeps posted facility name trimmed as-is", () => {
    expect(formatV2ThresholdFacilityName("Oakridge ALF")).toBe("Oakridge ALF");
    expect(formatV2ThresholdFacilityName("  Oakridge ALF  ")).toBe("Oakridge ALF");
  });

  it("replaces legacy Unnamed facility copy with a named gap", () => {
    expect(formatV2ThresholdFacilityName("Unnamed facility")).toBe(
      V2_THRESHOLDS_NO_FACILITY_POSTED_COPY,
    );
    expect(formatV2ThresholdFacilityName("  Unnamed facility  ")).toBe(
      V2_THRESHOLDS_NO_FACILITY_POSTED_COPY,
    );
    expect(formatV2ThresholdFacilityName("Unnamed facility")).not.toBe("Unnamed facility");
  });

  it("replaces legacy Unknown copy with a named gap", () => {
    expect(formatV2ThresholdFacilityName("Unknown")).toBe(V2_THRESHOLDS_NO_FACILITY_POSTED_COPY);
    expect(formatV2ThresholdFacilityName("  Unknown  ")).toBe(
      V2_THRESHOLDS_NO_FACILITY_POSTED_COPY,
    );
    expect(formatV2ThresholdFacilityName("Unknown")).not.toBe("Unknown");
  });
});
