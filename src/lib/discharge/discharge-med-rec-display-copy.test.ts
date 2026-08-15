import { describe, expect, it } from "vitest";

import {
  DISCHARGE_MED_REC_NO_NAME_POSTED_COPY,
  DISCHARGE_MED_REC_NO_RESIDENT_POSTED_COPY,
  dischargeMedRecHubKpiTileIsMetric,
  formatDischargeMedRecHubKpiValue,
  formatDischargeMedRecResidentName,
} from "./discharge-med-rec-display-copy";

describe("formatDischargeMedRecHubKpiValue", () => {
  it("returns named loading copy per tile", () => {
    expect(formatDischargeMedRecHubKpiValue("planning_gaps", 0, true)).toBe(
      "Loading planning gaps count…",
    );
    expect(formatDischargeMedRecHubKpiValue("pharmacist_review", 3, true)).toBe(
      "Loading external pharmacist review count…",
    );
    expect(formatDischargeMedRecHubKpiValue("ready_to_complete", null, true)).toBe(
      "Loading ready to complete count…",
    );
  });

  it("keeps real zero as numeric zero when loaded", () => {
    expect(formatDischargeMedRecHubKpiValue("planning_gaps", 0, false)).toBe(0);
    expect(formatDischargeMedRecHubKpiValue("pharmacist_review", 0, false)).toBe(0);
    expect(formatDischargeMedRecHubKpiValue("ready_to_complete", 0, false)).toBe(0);
  });

  it("returns posted positive counts unchanged", () => {
    expect(formatDischargeMedRecHubKpiValue("planning_gaps", 4, false)).toBe(4);
    expect(formatDischargeMedRecHubKpiValue("pharmacist_review", 2, false)).toBe(2);
    expect(formatDischargeMedRecHubKpiValue("ready_to_complete", 1, false)).toBe(1);
  });

  it("names missing counts instead of silent em dashes", () => {
    expect(formatDischargeMedRecHubKpiValue("planning_gaps", null, false)).toBe(
      "No planning gaps count posted",
    );
    expect(formatDischargeMedRecHubKpiValue("pharmacist_review", undefined, false)).toBe(
      "No external pharmacist review count posted",
    );
    expect(formatDischargeMedRecHubKpiValue("ready_to_complete", null, false)).toBe(
      "No ready to complete count posted",
    );
  });
});

describe("dischargeMedRecHubKpiTileIsMetric", () => {
  it("treats numeric displays as metrics", () => {
    expect(dischargeMedRecHubKpiTileIsMetric(0)).toBe(true);
    expect(dischargeMedRecHubKpiTileIsMetric(7)).toBe(true);
  });

  it("treats gap copy as messages", () => {
    expect(dischargeMedRecHubKpiTileIsMetric("Loading planning gaps count…")).toBe(false);
    expect(dischargeMedRecHubKpiTileIsMetric("No ready to complete count posted")).toBe(false);
  });
});

describe("formatDischargeMedRecResidentName", () => {
  it("names a missing resident join", () => {
    expect(formatDischargeMedRecResidentName(null)).toBe(
      DISCHARGE_MED_REC_NO_RESIDENT_POSTED_COPY,
    );
    expect(formatDischargeMedRecResidentName(undefined)).toBe(
      DISCHARGE_MED_REC_NO_RESIDENT_POSTED_COPY,
    );
  });

  it("names blank posted names", () => {
    expect(formatDischargeMedRecResidentName({ first_name: "", last_name: "" })).toBe(
      DISCHARGE_MED_REC_NO_NAME_POSTED_COPY,
    );
    expect(formatDischargeMedRecResidentName({ first_name: "   ", last_name: "  " })).toBe(
      DISCHARGE_MED_REC_NO_NAME_POSTED_COPY,
    );
  });

  it("names em dash and legacy generic placeholders", () => {
    expect(formatDischargeMedRecResidentName({ first_name: "—", last_name: "" })).toBe(
      DISCHARGE_MED_REC_NO_NAME_POSTED_COPY,
    );
    expect(formatDischargeMedRecResidentName({ first_name: "Unknown", last_name: "" })).toBe(
      DISCHARGE_MED_REC_NO_NAME_POSTED_COPY,
    );
    expect(formatDischargeMedRecResidentName({ first_name: "Unknown resident", last_name: "" })).toBe(
      DISCHARGE_MED_REC_NO_NAME_POSTED_COPY,
    );
    expect(formatDischargeMedRecResidentName({ first_name: "Unknown Resident", last_name: "" })).toBe(
      DISCHARGE_MED_REC_NO_NAME_POSTED_COPY,
    );
    expect(formatDischargeMedRecResidentName({ first_name: "Unnamed", last_name: "" })).toBe(
      DISCHARGE_MED_REC_NO_NAME_POSTED_COPY,
    );
    expect(formatDischargeMedRecResidentName({ first_name: "Unnamed resident", last_name: "" })).toBe(
      DISCHARGE_MED_REC_NO_NAME_POSTED_COPY,
    );
  });

  it("keeps a posted resident name", () => {
    expect(formatDischargeMedRecResidentName({ first_name: "Resident", last_name: "Alpha" })).toBe(
      "Resident Alpha",
    );
    expect(formatDischargeMedRecResidentName({ first_name: "Resident", last_name: null })).toBe(
      "Resident",
    );
    expect(formatDischargeMedRecResidentName({ first_name: null, last_name: "Beta" })).toBe("Beta");
  });

  it("never surfaces Unknown, Unknown resident, or a lone em dash", () => {
    expect(DISCHARGE_MED_REC_NO_RESIDENT_POSTED_COPY).toBe("No resident posted");
    expect(DISCHARGE_MED_REC_NO_NAME_POSTED_COPY).toBe("No name posted");
    expect(formatDischargeMedRecResidentName(null)).not.toBe("Unknown");
    expect(formatDischargeMedRecResidentName(null)).not.toBe("Unknown resident");
    expect(formatDischargeMedRecResidentName(null)).not.toBe("Unknown Resident");
    expect(formatDischargeMedRecResidentName(null)).not.toBe("—");
    expect(formatDischargeMedRecResidentName({ first_name: "Unknown", last_name: null })).not.toBe(
      "Unknown",
    );
    expect(formatDischargeMedRecResidentName({ first_name: "—", last_name: null })).not.toBe("—");
  });
});
