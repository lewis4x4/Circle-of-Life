import { describe, expect, it } from "vitest";

import {
  USER_ATTRIBUTION_NO_NAME_COPY,
  formatUploadedByProfile,
} from "./user-attribution";

const EM_DASH = "—";
const PLACEHOLDER_NAME = "Jordan Lee";
const PLACEHOLDER_EMAIL = "jordan.lee@example.com";

describe("formatUploadedByProfile", () => {
  it("names a missing profile row instead of generic Unknown copy", () => {
    expect(formatUploadedByProfile(null)).toBe(USER_ATTRIBUTION_NO_NAME_COPY);
    expect(formatUploadedByProfile(undefined)).toBe(USER_ATTRIBUTION_NO_NAME_COPY);
    expect(formatUploadedByProfile(null)).not.toBe("Unknown");
  });

  it("names blank and em-dash fields instead of a silent dash", () => {
    expect(formatUploadedByProfile({})).toBe(USER_ATTRIBUTION_NO_NAME_COPY);
    expect(
      formatUploadedByProfile({
        display_name: "",
        full_name: "   ",
        email: EM_DASH,
        first_name: `  ${EM_DASH}  `,
        last_name: "",
      }),
    ).toBe(USER_ATTRIBUTION_NO_NAME_COPY);
  });

  it("maps legacy Unknown field values to the named gap copy", () => {
    expect(
      formatUploadedByProfile({
        display_name: "Unknown",
        full_name: "unknown",
        email: "  Unknown  ",
        first_name: "Unknown",
        last_name: "unknown",
      }),
    ).toBe(USER_ATTRIBUTION_NO_NAME_COPY);
  });

  it("returns posted display_name trimmed as-is", () => {
    expect(
      formatUploadedByProfile({
        display_name: `  ${PLACEHOLDER_NAME}  `,
        full_name: "Other Name",
        email: PLACEHOLDER_EMAIL,
      }),
    ).toBe(PLACEHOLDER_NAME);
  });

  it("falls back to full_name when display_name is a gap", () => {
    expect(
      formatUploadedByProfile({
        display_name: EM_DASH,
        full_name: `  ${PLACEHOLDER_NAME}  `,
        email: PLACEHOLDER_EMAIL,
      }),
    ).toBe(PLACEHOLDER_NAME);
  });

  it("falls back to email when display and full names are gaps", () => {
    expect(
      formatUploadedByProfile({
        display_name: "Unknown",
        full_name: "",
        email: `  ${PLACEHOLDER_EMAIL}  `,
      }),
    ).toBe(PLACEHOLDER_EMAIL);
  });

  it("falls back to first and last name when earlier fields are gaps", () => {
    expect(
      formatUploadedByProfile({
        display_name: EM_DASH,
        full_name: "Unknown",
        email: "",
        first_name: "Jordan",
        last_name: "Lee",
      }),
    ).toBe(PLACEHOLDER_NAME);
  });

  it("returns a single posted name part when the other is a gap", () => {
    expect(
      formatUploadedByProfile({
        first_name: "Jordan",
        last_name: EM_DASH,
      }),
    ).toBe("Jordan");
    expect(
      formatUploadedByProfile({
        first_name: "",
        last_name: "Lee",
      }),
    ).toBe("Lee");
  });
});
