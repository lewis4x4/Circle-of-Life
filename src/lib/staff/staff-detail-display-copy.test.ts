import { describe, expect, it } from "vitest";

import {
  STAFF_DETAIL_NO_ALT_PHONE_COPY,
  STAFF_DETAIL_NO_EMAIL_COPY,
  STAFF_DETAIL_NO_EMERGENCY_NAME_COPY,
  STAFF_DETAIL_NO_EMERGENCY_PHONE_COPY,
  STAFF_DETAIL_NO_EMERGENCY_RELATIONSHIP_COPY,
  STAFF_DETAIL_NO_MAX_HOURS_COPY,
  STAFF_DETAIL_NO_PHONE_COPY,
  STAFF_DETAIL_NO_RATE_COPY,
  STAFF_DETAIL_NO_UPDATE_TIMESTAMP_COPY,
  formatStaffDetailAltPhone,
  formatStaffDetailEmail,
  formatStaffDetailEmergencyName,
  formatStaffDetailEmergencyPhone,
  formatStaffDetailEmergencyRelationship,
  formatStaffDetailMaxHours,
  formatStaffDetailPhone,
  formatStaffDetailRateCents,
  formatStaffDetailUpdatedAt,
} from "./staff-detail-display-copy";

const EM_DASH = "—";

describe("formatStaffDetailPhone", () => {
  it("names a missing phone instead of an em dash", () => {
    expect(formatStaffDetailPhone(null)).toBe(STAFF_DETAIL_NO_PHONE_COPY);
    expect(formatStaffDetailPhone("")).toBe(STAFF_DETAIL_NO_PHONE_COPY);
    expect(formatStaffDetailPhone("   ")).toBe(STAFF_DETAIL_NO_PHONE_COPY);
    expect(formatStaffDetailPhone(null)).not.toBe(EM_DASH);
  });

  it("returns a posted phone", () => {
    expect(formatStaffDetailPhone("(352) 555-0100")).toBe("(352) 555-0100");
  });
});

describe("formatStaffDetailAltPhone", () => {
  it("names a missing alt phone instead of an em dash", () => {
    expect(formatStaffDetailAltPhone(null)).toBe(STAFF_DETAIL_NO_ALT_PHONE_COPY);
    expect(formatStaffDetailAltPhone("")).toBe(STAFF_DETAIL_NO_ALT_PHONE_COPY);
    expect(formatStaffDetailAltPhone(null)).not.toBe(EM_DASH);
  });

  it("returns a posted alt phone", () => {
    expect(formatStaffDetailAltPhone("(352) 555-0101")).toBe("(352) 555-0101");
  });
});

describe("formatStaffDetailEmail", () => {
  it("names a missing email instead of an em dash", () => {
    expect(formatStaffDetailEmail(null)).toBe(STAFF_DETAIL_NO_EMAIL_COPY);
    expect(formatStaffDetailEmail("")).toBe(STAFF_DETAIL_NO_EMAIL_COPY);
    expect(formatStaffDetailEmail(null)).not.toBe(EM_DASH);
  });

  it("returns a posted email", () => {
    expect(formatStaffDetailEmail("staff@example.com")).toBe("staff@example.com");
  });
});

describe("formatStaffDetailEmergencyName", () => {
  it("names a missing emergency contact instead of an em dash", () => {
    expect(formatStaffDetailEmergencyName(null)).toBe(STAFF_DETAIL_NO_EMERGENCY_NAME_COPY);
    expect(formatStaffDetailEmergencyName("")).toBe(STAFF_DETAIL_NO_EMERGENCY_NAME_COPY);
    expect(formatStaffDetailEmergencyName(null)).not.toBe(EM_DASH);
  });

  it("returns a posted emergency contact name", () => {
    expect(formatStaffDetailEmergencyName("Jane Doe")).toBe("Jane Doe");
  });
});

describe("formatStaffDetailEmergencyRelationship", () => {
  it("names a missing relationship instead of an em dash", () => {
    expect(formatStaffDetailEmergencyRelationship(null)).toBe(
      STAFF_DETAIL_NO_EMERGENCY_RELATIONSHIP_COPY,
    );
    expect(formatStaffDetailEmergencyRelationship("")).toBe(
      STAFF_DETAIL_NO_EMERGENCY_RELATIONSHIP_COPY,
    );
    expect(formatStaffDetailEmergencyRelationship(null)).not.toBe(EM_DASH);
  });

  it("returns a posted relationship", () => {
    expect(formatStaffDetailEmergencyRelationship("Spouse")).toBe("Spouse");
  });
});

describe("formatStaffDetailEmergencyPhone", () => {
  it("names a missing emergency phone instead of an em dash", () => {
    expect(formatStaffDetailEmergencyPhone(null)).toBe(STAFF_DETAIL_NO_EMERGENCY_PHONE_COPY);
    expect(formatStaffDetailEmergencyPhone("")).toBe(STAFF_DETAIL_NO_EMERGENCY_PHONE_COPY);
    expect(formatStaffDetailEmergencyPhone(null)).not.toBe(EM_DASH);
  });

  it("returns a posted emergency phone", () => {
    expect(formatStaffDetailEmergencyPhone("(352) 555-0199")).toBe("(352) 555-0199");
  });
});

describe("formatStaffDetailMaxHours", () => {
  it("names missing max hours instead of an em dash", () => {
    expect(formatStaffDetailMaxHours(null)).toBe(STAFF_DETAIL_NO_MAX_HOURS_COPY);
    expect(formatStaffDetailMaxHours(undefined)).toBe(STAFF_DETAIL_NO_MAX_HOURS_COPY);
    expect(formatStaffDetailMaxHours(null)).not.toBe(EM_DASH);
  });

  it("returns a posted max hours value including zero", () => {
    expect(formatStaffDetailMaxHours(40)).toBe("40");
    expect(formatStaffDetailMaxHours(0)).toBe("0");
  });
});

describe("formatStaffDetailRateCents", () => {
  it("names a missing rate instead of an em dash", () => {
    expect(formatStaffDetailRateCents(null)).toBe(STAFF_DETAIL_NO_RATE_COPY);
    expect(formatStaffDetailRateCents(undefined)).toBe(STAFF_DETAIL_NO_RATE_COPY);
    expect(formatStaffDetailRateCents(null)).not.toBe(EM_DASH);
  });

  it("formats a posted rate in USD", () => {
    expect(formatStaffDetailRateCents(1850)).toBe("$18.50");
  });
});

describe("formatStaffDetailUpdatedAt", () => {
  it("names a missing update timestamp instead of an em dash", () => {
    expect(formatStaffDetailUpdatedAt(null)).toBe(STAFF_DETAIL_NO_UPDATE_TIMESTAMP_COPY);
    expect(formatStaffDetailUpdatedAt("")).toBe(STAFF_DETAIL_NO_UPDATE_TIMESTAMP_COPY);
    expect(formatStaffDetailUpdatedAt("not-a-date")).toBe(STAFF_DETAIL_NO_UPDATE_TIMESTAMP_COPY);
    expect(formatStaffDetailUpdatedAt(null)).not.toBe(EM_DASH);
  });

  it("formats a posted timestamp", () => {
    const formatted = formatStaffDetailUpdatedAt("2026-04-08T15:30:00.000Z");
    expect(formatted).toMatch(/Apr/);
    expect(formatted).toMatch(/2026/);
  });
});
