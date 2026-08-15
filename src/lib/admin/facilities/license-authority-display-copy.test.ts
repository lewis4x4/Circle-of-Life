import { describe, expect, it } from "vitest";

import { defaultAssistedLivingAuthorityLabel } from "./license-authority";
import { LICENSE_AUTHORITY_NO_AUTHORITY_COPY } from "./license-authority-display-copy";

const EM_DASH = "—";
const FIXTURE_STATE = "GA";

describe("defaultAssistedLivingAuthorityLabel", () => {
  it("names a missing or invalid state instead of an em dash", () => {
    expect(defaultAssistedLivingAuthorityLabel(null)).toBe(LICENSE_AUTHORITY_NO_AUTHORITY_COPY);
    expect(defaultAssistedLivingAuthorityLabel(undefined)).toBe(LICENSE_AUTHORITY_NO_AUTHORITY_COPY);
    expect(defaultAssistedLivingAuthorityLabel("")).toBe(LICENSE_AUTHORITY_NO_AUTHORITY_COPY);
    expect(defaultAssistedLivingAuthorityLabel("   ")).toBe(LICENSE_AUTHORITY_NO_AUTHORITY_COPY);
    expect(defaultAssistedLivingAuthorityLabel("F")).toBe(LICENSE_AUTHORITY_NO_AUTHORITY_COPY);
    expect(defaultAssistedLivingAuthorityLabel("FLA")).toBe(LICENSE_AUTHORITY_NO_AUTHORITY_COPY);
    expect(defaultAssistedLivingAuthorityLabel(null)).not.toBe(EM_DASH);
  });

  it("returns the Florida AHCA label for FL", () => {
    expect(defaultAssistedLivingAuthorityLabel("FL")).toBe(
      "Florida Agency for Health Care Administration (AHCA)",
    );
    expect(defaultAssistedLivingAuthorityLabel(" fl ")).toBe(
      "Florida Agency for Health Care Administration (AHCA)",
    );
  });

  it("returns the generic state regulatory caption for other 2-letter states", () => {
    const label = defaultAssistedLivingAuthorityLabel(FIXTURE_STATE);
    expect(label).toBe(
      `State regulatory authority (${FIXTURE_STATE}) — confirm license issuer on file`,
    );
    expect(label).not.toBe(LICENSE_AUTHORITY_NO_AUTHORITY_COPY);
  });
});
