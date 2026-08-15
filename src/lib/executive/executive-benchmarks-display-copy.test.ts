import { describe, expect, it } from "vitest";

import {
  EXECUTIVE_NO_FACILITIES_POSTED_COPY,
  formatExecutiveBenchmarkFacilitiesDisplay,
} from "./executive-benchmarks-display-copy";

const facNameById = {
  "aaaaaaaa-1111-1111-1111-111111111111": "Site Alpha",
  "bbbbbbbb-2222-2222-2222-222222222222": "Site Beta",
};

describe("formatExecutiveBenchmarkFacilitiesDisplay", () => {
  it("names the gap when facility_ids is an empty array", () => {
    expect(
      formatExecutiveBenchmarkFacilitiesDisplay({ facilityIds: [], facNameById }),
    ).toBe(EXECUTIVE_NO_FACILITIES_POSTED_COPY);
  });

  it("names the gap when facility_ids is missing", () => {
    expect(
      formatExecutiveBenchmarkFacilitiesDisplay({ facilityIds: null, facNameById }),
    ).toBe(EXECUTIVE_NO_FACILITIES_POSTED_COPY);
    expect(
      formatExecutiveBenchmarkFacilitiesDisplay({ facilityIds: undefined, facNameById }),
    ).toBe(EXECUTIVE_NO_FACILITIES_POSTED_COPY);
  });

  it("joins posted facility labels", () => {
    expect(
      formatExecutiveBenchmarkFacilitiesDisplay({
        facilityIds: [
          "aaaaaaaa-1111-1111-1111-111111111111",
          "bbbbbbbb-2222-2222-2222-222222222222",
        ],
        facNameById,
      }),
    ).toBe("Site Alpha, Site Beta");
  });

  it("falls back to count when labels join is empty but ids are present", () => {
    expect(
      formatExecutiveBenchmarkFacilitiesDisplay({
        facilityIds: [""],
        facNameById: {},
      }),
    ).toBe("1 selected");
  });

  it("uses truncated id when name is not posted", () => {
    expect(
      formatExecutiveBenchmarkFacilitiesDisplay({
        facilityIds: ["cccccccc-3333-3333-3333-333333333333"],
        facNameById: {},
      }),
    ).toBe("cccccccc");
  });
});
