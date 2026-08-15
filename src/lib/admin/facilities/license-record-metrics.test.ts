import { describe, expect, it } from "vitest";

import {
  LICENSE_STANDING_NO_STANDING_COPY,
  licenseStandingLabel,
  type LicenseStanding,
} from "./license-record-metrics";

describe("licenseStandingLabel", () => {
  it("maps known standings to posted operator labels", () => {
    expect(licenseStandingLabel("active")).toBe("Active");
    expect(licenseStandingLabel("probation")).toBe("Probation");
    expect(licenseStandingLabel("suspended")).toBe("Suspended");
    expect(licenseStandingLabel("expired")).toBe("Expired");
    expect(licenseStandingLabel("pending")).toBe("Pending verification");
  });

  it("names an unrecognized standing gap instead of Unknown", () => {
    const unrecognized = "revoked" as LicenseStanding;
    expect(licenseStandingLabel(unrecognized)).toBe(LICENSE_STANDING_NO_STANDING_COPY);
    expect(licenseStandingLabel(unrecognized)).toBe("No standing posted");
    expect(licenseStandingLabel(unrecognized)).not.toBe("Unknown");
  });
});
