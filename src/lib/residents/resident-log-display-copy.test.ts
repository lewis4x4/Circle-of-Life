import { describe, expect, it } from "vitest";

import {
  RESIDENT_DAILY_NOTES_EMPTY_COPY,
  formatResidentDailyNotesDisplay,
} from "./resident-log-display-copy";

describe("formatResidentDailyNotesDisplay", () => {
  it("names a gap when general notes are missing", () => {
    expect(formatResidentDailyNotesDisplay(null)).toBe(RESIDENT_DAILY_NOTES_EMPTY_COPY);
    expect(formatResidentDailyNotesDisplay(undefined)).toBe(RESIDENT_DAILY_NOTES_EMPTY_COPY);
  });

  it("names a gap when general notes are blank or whitespace only", () => {
    expect(formatResidentDailyNotesDisplay("")).toBe(RESIDENT_DAILY_NOTES_EMPTY_COPY);
    expect(formatResidentDailyNotesDisplay("   ")).toBe(RESIDENT_DAILY_NOTES_EMPTY_COPY);
    expect(formatResidentDailyNotesDisplay("\n\t  \n")).toBe(RESIDENT_DAILY_NOTES_EMPTY_COPY);
  });

  it("returns trimmed posted notes as-is", () => {
    expect(formatResidentDailyNotesDisplay("Feeling well today")).toBe("Feeling well today");
    expect(formatResidentDailyNotesDisplay("  Ate breakfast.  ")).toBe("Ate breakfast.");
  });
});
