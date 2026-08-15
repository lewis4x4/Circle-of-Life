import { describe, expect, it } from "vitest";

import {
  FACILITY_HEADER_NO_LABOR_SHARE_COPY,
  FACILITY_HEADER_NO_READINESS_COPY,
  formatFacilityHeaderLaborSharePct,
  formatFacilityHeaderSurveyReadinessPct,
} from "./facility-header-display-copy";

const EM_DASH = "—";

describe("formatFacilityHeaderLaborSharePct", () => {
  it("names a missing labor share instead of an em dash", () => {
    expect(formatFacilityHeaderLaborSharePct(null)).toBe(FACILITY_HEADER_NO_LABOR_SHARE_COPY);
    expect(formatFacilityHeaderLaborSharePct(undefined)).toBe(FACILITY_HEADER_NO_LABOR_SHARE_COPY);
    expect(formatFacilityHeaderLaborSharePct(Number.NaN)).toBe(FACILITY_HEADER_NO_LABOR_SHARE_COPY);
    expect(formatFacilityHeaderLaborSharePct(null)).not.toBe(EM_DASH);
  });

  it("keeps posted zero as 0%", () => {
    expect(formatFacilityHeaderLaborSharePct(0)).toBe("0%");
  });

  it("formats a positive posted share", () => {
    expect(formatFacilityHeaderLaborSharePct(31.6)).toBe("32%");
    expect(formatFacilityHeaderLaborSharePct(72)).toBe("72%");
  });
});

describe("formatFacilityHeaderSurveyReadinessPct", () => {
  it("names missing readiness instead of an em dash", () => {
    expect(formatFacilityHeaderSurveyReadinessPct(null)).toBe(FACILITY_HEADER_NO_READINESS_COPY);
    expect(formatFacilityHeaderSurveyReadinessPct(undefined)).toBe(FACILITY_HEADER_NO_READINESS_COPY);
    expect(formatFacilityHeaderSurveyReadinessPct(Number.NaN)).toBe(FACILITY_HEADER_NO_READINESS_COPY);
    expect(formatFacilityHeaderSurveyReadinessPct(null)).not.toBe(EM_DASH);
  });

  it("keeps posted zero as 0%", () => {
    expect(formatFacilityHeaderSurveyReadinessPct(0)).toBe("0%");
  });

  it("formats a positive posted readiness", () => {
    expect(formatFacilityHeaderSurveyReadinessPct(84.4)).toBe("84%");
    expect(formatFacilityHeaderSurveyReadinessPct(100)).toBe("100%");
  });
});
