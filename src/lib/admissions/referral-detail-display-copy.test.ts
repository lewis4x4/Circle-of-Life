import { describe, expect, it } from "vitest";

import { ADMISSIONS_HUB_MISSING_DATE_COPY } from "./admissions-hub-display-copy";
import {
  REFERRAL_DETAIL_NO_CONVERTED_RESIDENT_COPY,
  REFERRAL_DETAIL_NO_DATE_OF_BIRTH_COPY,
  REFERRAL_DETAIL_NO_EMAIL_COPY,
  REFERRAL_DETAIL_NO_PHONE_COPY,
  formatReferralDetailConvertedResidentId,
  formatReferralDetailDateOfBirth,
  formatReferralDetailEmail,
  formatReferralDetailPhone,
  formatReferralDetailTimestamp,
} from "./referral-detail-display-copy";

const EM_DASH = "—";

describe("formatReferralDetailTimestamp", () => {
  it("names a missing timestamp instead of an em dash", () => {
    expect(formatReferralDetailTimestamp(null)).toBe(ADMISSIONS_HUB_MISSING_DATE_COPY);
    expect(formatReferralDetailTimestamp("")).toBe(ADMISSIONS_HUB_MISSING_DATE_COPY);
    expect(formatReferralDetailTimestamp("   ")).toBe(ADMISSIONS_HUB_MISSING_DATE_COPY);
    expect(formatReferralDetailTimestamp(null)).not.toBe(EM_DASH);
  });

  it("names an unparseable timestamp instead of an em dash", () => {
    expect(formatReferralDetailTimestamp("not-a-date")).toBe(ADMISSIONS_HUB_MISSING_DATE_COPY);
  });

  it("formats a posted timestamp with locale string", () => {
    const formatted = formatReferralDetailTimestamp("2026-04-08T15:30:00.000Z");
    expect(formatted).toBe(new Date("2026-04-08T15:30:00.000Z").toLocaleString());
  });
});

describe("formatReferralDetailDateOfBirth", () => {
  it("names a missing date of birth instead of an em dash", () => {
    expect(formatReferralDetailDateOfBirth(null)).toBe(REFERRAL_DETAIL_NO_DATE_OF_BIRTH_COPY);
    expect(formatReferralDetailDateOfBirth("")).toBe(REFERRAL_DETAIL_NO_DATE_OF_BIRTH_COPY);
    expect(formatReferralDetailDateOfBirth("   ")).toBe(REFERRAL_DETAIL_NO_DATE_OF_BIRTH_COPY);
    expect(formatReferralDetailDateOfBirth(null)).not.toBe(EM_DASH);
  });

  it("returns a posted date of birth", () => {
    expect(formatReferralDetailDateOfBirth("2020-01-15")).toBe("2020-01-15");
  });
});

describe("formatReferralDetailPhone", () => {
  it("names a missing phone instead of an em dash", () => {
    expect(formatReferralDetailPhone(null)).toBe(REFERRAL_DETAIL_NO_PHONE_COPY);
    expect(formatReferralDetailPhone("")).toBe(REFERRAL_DETAIL_NO_PHONE_COPY);
    expect(formatReferralDetailPhone("   ")).toBe(REFERRAL_DETAIL_NO_PHONE_COPY);
    expect(formatReferralDetailPhone(null)).not.toBe(EM_DASH);
  });

  it("returns a posted phone", () => {
    expect(formatReferralDetailPhone("555-0100")).toBe("555-0100");
  });
});

describe("formatReferralDetailEmail", () => {
  it("names a missing email instead of an em dash", () => {
    expect(formatReferralDetailEmail(null)).toBe(REFERRAL_DETAIL_NO_EMAIL_COPY);
    expect(formatReferralDetailEmail("")).toBe(REFERRAL_DETAIL_NO_EMAIL_COPY);
    expect(formatReferralDetailEmail("   ")).toBe(REFERRAL_DETAIL_NO_EMAIL_COPY);
    expect(formatReferralDetailEmail(null)).not.toBe(EM_DASH);
  });

  it("returns a posted email", () => {
    expect(formatReferralDetailEmail("lead@example.com")).toBe("lead@example.com");
  });
});

describe("formatReferralDetailConvertedResidentId", () => {
  it("names a missing converted resident id instead of an em dash", () => {
    expect(formatReferralDetailConvertedResidentId(null)).toBe(
      REFERRAL_DETAIL_NO_CONVERTED_RESIDENT_COPY,
    );
    expect(formatReferralDetailConvertedResidentId("")).toBe(
      REFERRAL_DETAIL_NO_CONVERTED_RESIDENT_COPY,
    );
    expect(formatReferralDetailConvertedResidentId("   ")).toBe(
      REFERRAL_DETAIL_NO_CONVERTED_RESIDENT_COPY,
    );
    expect(formatReferralDetailConvertedResidentId(null)).not.toBe(EM_DASH);
  });

  it("returns a posted resident id as-is without lookup", () => {
    const residentId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(formatReferralDetailConvertedResidentId(residentId)).toBe(residentId);
  });
});
