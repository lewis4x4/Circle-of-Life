import { describe, expect, it } from "vitest";

import {
  COLLECTIONS_HUB_LIMIT,
  COLLECTIONS_NO_FOLLOW_UP_DATE_COPY,
  COLLECTIONS_NO_RESIDENT_NAME_COPY,
  collectionsFollowUpDateIsPosted,
  collectionsHubLoadCapNotice,
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

describe("collectionsHubLoadCapNotice", () => {
  it("stays quiet when the loaded list is under the hub cap", () => {
    expect(collectionsHubLoadCapNotice(0)).toBeNull();
    expect(collectionsHubLoadCapNotice(199)).toBeNull();
  });

  it("names the hub load cap when the fetch is full", () => {
    expect(collectionsHubLoadCapNotice(COLLECTIONS_HUB_LIMIT)).toBe(
      `Loaded the ${COLLECTIONS_HUB_LIMIT} most recent collection activities. Older activities are not listed on this hub.`,
    );
  });
});

describe("collectionsFollowUpDateIsPosted", () => {
  it("detects posted vs missing follow-up dates", () => {
    expect(collectionsFollowUpDateIsPosted("2026-04-08")).toBe(true);
    expect(collectionsFollowUpDateIsPosted(null)).toBe(false);
  });
});
