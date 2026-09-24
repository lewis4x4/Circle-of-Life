import { describe, expect, it } from "vitest";

import {
  formatDateTimeWith,
  formatDisplayDate,
  formatDisplayDateTime,
  formatDisplayTime,
  formatDurationHoursMinutes,
  formatPersonName,
  formatPersonNameLastFirst,
  formatProfileName,
  formatRelativeTime,
  formatShortDateTime,
  isDateOnlyString,
  looksLikeLoginIdentifier,
} from "@/lib/format/datetime";

// 2026-09-16 02:05 UTC is 10:05 PM on Sep 15 in Florida (HOM-2026-0002).
const LATE_EVENING_INCIDENT = "2026-09-16T02:05:00+00:00";

describe("formatDisplayDate", () => {
  it("shows a date-only value as the stored calendar day, not UTC midnight shifted west", () => {
    // Homewood's AHCA licence expiry is stored as 2026-09-27; it rendered Sep 26.
    expect(formatDisplayDate("2026-09-27")).toBe("Sep 27, 2026");
    expect(formatDisplayDate("2026-09-27", { timeZone: "America/Los_Angeles" })).toBe("Sep 27, 2026");
    expect(formatDisplayDate("2026-09-27", { timeZone: "Pacific/Kiritimati" })).toBe("Sep 27, 2026");
  });

  it("shows an instant as the day it was in the facility's zone", () => {
    expect(formatDisplayDate(LATE_EVENING_INCIDENT)).toBe("Sep 15, 2026");
    expect(formatDisplayDate(LATE_EVENING_INCIDENT, { timeZone: "UTC" })).toBe("Sep 16, 2026");
  });

  it("names the gap for missing, blank, invalid and impossible dates", () => {
    expect(formatDisplayDate(null)).toBe("No date posted");
    expect(formatDisplayDate("   ")).toBe("No date posted");
    expect(formatDisplayDate("not a date")).toBe("No date posted");
    expect(formatDisplayDate("2026-02-31")).toBe("No date posted");
    expect(formatDisplayDate(null, { fallback: "—" })).toBe("—");
  });

  it("recognises date-only strings", () => {
    expect(isDateOnlyString("2026-09-27")).toBe(true);
    expect(isDateOnlyString("2026-09-27T00:00:00Z")).toBe(false);
  });
});

describe("instant formatters always use the facility zone", () => {
  it("renders the same text regardless of the runtime zone", () => {
    // The incidents board rendered 10:05 PM on the client and 2:05 AM on the server.
    expect(formatShortDateTime(LATE_EVENING_INCIDENT)).toBe("Sep 15, 10:05 PM");
    expect(formatDisplayDateTime(LATE_EVENING_INCIDENT)).toBe("Sep 15, 2026, 10:05 PM");
    expect(formatDisplayTime(LATE_EVENING_INCIDENT)).toBe("10:05 PM");
  });

  it("honours an explicit facility zone and survives a bad one", () => {
    expect(formatDisplayTime(LATE_EVENING_INCIDENT, { timeZone: "America/Chicago" })).toBe("9:05 PM");
    expect(formatDisplayTime(LATE_EVENING_INCIDENT, { timeZone: "Not/AZone" })).toBe("10:05 PM");
  });
});

describe("formatRelativeTime", () => {
  const now = "2026-09-22T12:00:00Z";

  it("rolls minutes into hours and days", () => {
    expect(formatRelativeTime("2026-09-22T11:59:40Z", now)).toBe("Now");
    expect(formatRelativeTime("2026-09-22T11:48:00Z", now)).toBe("12m ago");
    expect(formatRelativeTime("2026-09-22T09:00:00Z", now)).toBe("3h ago");
    // 2462 minutes: the rounding board printed "2462m ago".
    expect(formatRelativeTime(new Date(Date.parse(now) - 2462 * 60_000), now)).toBe("41h ago");
    expect(formatRelativeTime("2026-09-19T12:00:00Z", now)).toBe("3d ago");
  });

  it("speaks about the future", () => {
    expect(formatRelativeTime("2026-09-22T12:40:00Z", now)).toBe("in 40m");
    expect(formatRelativeTime("2026-09-22T17:00:00Z", now)).toBe("in 5h");
  });

  it("names the gap", () => {
    expect(formatRelativeTime(null, now)).toBe("No date posted");
  });
});

describe("formatDurationHoursMinutes", () => {
  it("renders h:mm", () => {
    expect(formatDurationHoursMinutes(0)).toBe("0:00");
    expect(formatDurationHoursMinutes(425)).toBe("7:05");
    expect(formatDurationHoursMinutes(59.6)).toBe("1:00");
    expect(formatDurationHoursMinutes(-5)).toBe("0:00");
    expect(formatDurationHoursMinutes(null, { fallback: "Not clocked" })).toBe("Not clocked");
  });
});

describe("formatPersonName", () => {
  it("is always First Last", () => {
    expect(formatPersonName({ first_name: "Ada", last_name: "Lovelace" })).toBe("Ada Lovelace");
    expect(formatPersonName({ first_name: "Robert", preferred_name: "Bob", last_name: "Smith" })).toBe("Bob Smith");
    expect(formatPersonName({ first_name: "  ", last_name: "Cher" })).toBe("Cher");
    expect(formatPersonName(null)).toBe("No name posted");
    expect(formatPersonName({ first_name: "", last_name: null })).toBe("No name posted");
  });
});

describe("formatPersonNameLastFirst (exports and sort keys only)", () => {
  it("writes surname first, preferred name when posted", () => {
    expect(formatPersonNameLastFirst({ first_name: "James", last_name: "Baker", preferred_name: "Jimmie" })).toBe("Baker, Jimmie");
    expect(formatPersonNameLastFirst({ first_name: "Ada", last_name: "" })).toBe("Ada");
    expect(formatPersonNameLastFirst(null)).toBe("No name posted");
  });
});

describe("formatProfileName never shows a login identifier", () => {
  it("keeps a real name", () => {
    expect(formatProfileName("Brian Lewis")).toBe("Brian Lewis");
    expect(formatProfileName("  Cher ")).toBe("Cher");
  });
  it("falls back for a handle, an email or a blank", () => {
    expect(formatProfileName("blewis")).toBe("Staff");
    expect(formatProfileName("someone@example.com", { fallback: "Assigned" })).toBe("Assigned");
    expect(formatProfileName("   ")).toBe("Staff");
    expect(formatProfileName(null)).toBe("Staff");
  });
  it("names the identifiers it refuses", () => {
    expect(looksLikeLoginIdentifier("j.smith")).toBe(true);
    expect(looksLikeLoginIdentifier("Jo Smith")).toBe(false);
  });
});

describe("formatDateTimeWith (COL-684)", () => {
  it("keeps a stored calendar day whatever the zone", () => {
    expect(formatDateTimeWith("2026-09-27", { weekday: "short", month: "short", day: "numeric" })).toBe("Sun, Sep 27");
  });
  it("reads an instant in the facility zone", () => {
    expect(formatDateTimeWith("2026-09-16T02:05:00+00:00", { month: "short", day: "numeric" })).toBe("Sep 15");
    expect(formatDateTimeWith("2026-09-16T02:05:00+00:00", { month: "short", day: "numeric" }, { timeZone: "UTC" })).toBe("Sep 16");
  });
  it("falls back on a missing or invalid value", () => {
    expect(formatDateTimeWith(null, { month: "short" })).toBe("No date posted");
    expect(formatDateTimeWith("nope", { month: "short" }, { fallback: "—" })).toBe("—");
  });
});
