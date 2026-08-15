import { describe, expect, it } from "vitest";

import {
  COLLECTIONS_NO_FOLLOW_UP_DATE_COPY,
  COLLECTIONS_NO_RESIDENT_NAME_COPY,
  collectionsFollowUpDateIsPosted,
  formatCollectionsFollowUpDate,
  formatCollectionsResidentName,
} from "./collections-display-copy";

describe("formatCollectionsResidentName", () => {
  it("joins posted first and last names", () => {
    expect(formatCollectionsResidentName("Ada", "Lovelace")).toBe("Ada Lovelace");
  });

  it("uses a single posted name part", () => {
    expect(formatCollectionsResidentName("Ada", null)).toBe("Ada");
    expect(formatCollectionsResidentName(null, "Lovelace")).toBe("Lovelace");
  });

  it("names the gap when both parts are missing or blank", () => {
    expect(formatCollectionsResidentName(null, null)).toBe(COLLECTIONS_NO_RESIDENT_NAME_COPY);
    expect(formatCollectionsResidentName("", "   ")).toBe(COLLECTIONS_NO_RESIDENT_NAME_COPY);
  });
});

describe("formatCollectionsFollowUpDate", () => {
  it("returns a posted date as-is", () => {
    expect(formatCollectionsFollowUpDate("2026-04-08")).toBe("2026-04-08");
  });

  it("names the gap when no follow-up date is posted", () => {
    expect(formatCollectionsFollowUpDate(null)).toBe(COLLECTIONS_NO_FOLLOW_UP_DATE_COPY);
    expect(formatCollectionsFollowUpDate("")).toBe(COLLECTIONS_NO_FOLLOW_UP_DATE_COPY);
    expect(formatCollectionsFollowUpDate("   ")).toBe(COLLECTIONS_NO_FOLLOW_UP_DATE_COPY);
    expect(formatCollectionsFollowUpDate("—")).toBe(COLLECTIONS_NO_FOLLOW_UP_DATE_COPY);
  });
});

describe("collectionsFollowUpDateIsPosted", () => {
  it("detects posted vs missing follow-up dates", () => {
    expect(collectionsFollowUpDateIsPosted("2026-04-08")).toBe(true);
    expect(collectionsFollowUpDateIsPosted(null)).toBe(false);
  });
});
