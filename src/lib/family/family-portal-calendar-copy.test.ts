import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FAMILY_CALENDAR_EMPTY_DESCRIPTION,
  FAMILY_CALENDAR_EMPTY_TITLE,
  FAMILY_CALENDAR_LOADING,
  FAMILY_CALENDAR_NO_LOCATION,
  FAMILY_CALENDAR_PAGE_DESCRIPTION,
  FAMILY_CALENDAR_PAGE_TITLE,
  FAMILY_CALENDAR_RETRY,
} from "@/lib/family/family-portal-copy";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const familyPortalCopyPath = path.join(repoRoot, "src/lib/family/family-portal-copy.ts");
const calendarPagePath = path.join(repoRoot, "src/app/(family)/family/calendar/page.tsx");
const calendarDataPath = path.join(repoRoot, "src/lib/family/family-calendar-data.ts");

const FORBIDDEN_CALENDAR_COPY = [
  /itinerary/i,
  /moments/i,
  /journal/i,
  /reply/i,
  /rsvp/i,
  /loved one/i,
  /retry connection/i,
];

function assertNoForbiddenCopy(label: string, text: string) {
  for (const pattern of FORBIDDEN_CALENDAR_COPY) {
    expect(text, `${label} must not match ${pattern}`).not.toMatch(pattern);
  }
}

describe("family calendar portal copy", () => {
  it("uses calm read-only calendar language in shared constants", () => {
    assertNoForbiddenCopy("page title", FAMILY_CALENDAR_PAGE_TITLE);
    assertNoForbiddenCopy("page description", FAMILY_CALENDAR_PAGE_DESCRIPTION);
    assertNoForbiddenCopy("loading", FAMILY_CALENDAR_LOADING);
    assertNoForbiddenCopy("retry", FAMILY_CALENDAR_RETRY);
    assertNoForbiddenCopy("empty title", FAMILY_CALENDAR_EMPTY_TITLE);
    assertNoForbiddenCopy("empty description", FAMILY_CALENDAR_EMPTY_DESCRIPTION);
    assertNoForbiddenCopy("no location", FAMILY_CALENDAR_NO_LOCATION);

    expect(FAMILY_CALENDAR_PAGE_TITLE).toBe("Calendar");
    expect(FAMILY_CALENDAR_LOADING).toBe("Loading the calendar…");
    expect(FAMILY_CALENDAR_RETRY).toBe("Retry");
    expect(FAMILY_CALENDAR_EMPTY_TITLE).toBe("No activities posted yet");
    expect(FAMILY_CALENDAR_PAGE_DESCRIPTION).toMatch(/read-only/i);
    expect(FAMILY_CALENDAR_PAGE_DESCRIPTION).toMatch(/care team/i);
    expect(FAMILY_CALENDAR_EMPTY_DESCRIPTION).toMatch(/care team shares an activity/i);
    expect(FAMILY_CALENDAR_NO_LOCATION).toBe("No location posted");
  });

  it("calendar page imports shared copy and has no family write affordances", () => {
    const source = fs.readFileSync(calendarPagePath, "utf8");

    expect(source).toMatch(/FAMILY_CALENDAR_PAGE_TITLE/);
    expect(source).toMatch(/FAMILY_CALENDAR_PAGE_DESCRIPTION/);
    expect(source).toMatch(/FAMILY_CALENDAR_LOADING/);
    expect(source).toMatch(/FAMILY_CALENDAR_RETRY/);
    expect(source).toMatch(/FAMILY_CALENDAR_EMPTY_TITLE/);
    expect(source).toMatch(/FAMILY_CALENDAR_EMPTY_DESCRIPTION/);

    expect(source).not.toMatch(/Syncing itinerary/i);
    expect(source).not.toMatch(/Upcoming Moments/i);
    expect(source).not.toMatch(/Retry Connection/i);
    expect(source).not.toMatch(/family access does not include/i);
    expect(source).not.toMatch(/textarea/);
    expect(source).not.toMatch(/RSVP/i);
    expect(source).not.toMatch(/postFamilyMessage/);
  });

  it("calendar data uses explicit no-location copy instead of invented placeholders", () => {
    const source = fs.readFileSync(calendarDataPath, "utf8");

    expect(source).toMatch(/FAMILY_CALENDAR_NO_LOCATION/);
    expect(source).not.toMatch(/Community program/);
    expect(source).toMatch(/getFamilyCalendarDateWindow/);
    expect(source).toMatch(/facilityDateIsoDaysFromToday/);
    expect(source).not.toMatch(/todayUtcYmd/);
    expect(source).not.toMatch(/toISOString\(\)\.slice\(0, 10\)/);
  });

  it("family-portal-copy module keeps calendar strings free of lifestyle metaphors", () => {
    const source = fs.readFileSync(familyPortalCopyPath, "utf8");
    const calendarBlock = source.slice(source.indexOf("FAMILY_CALENDAR_PAGE_TITLE"));

    for (const pattern of FORBIDDEN_CALENDAR_COPY) {
      expect(calendarBlock).not.toMatch(pattern);
    }
    expect(calendarBlock).toMatch(/read-only/i);
    expect(calendarBlock).toMatch(/No activities posted yet/);
  });
});
