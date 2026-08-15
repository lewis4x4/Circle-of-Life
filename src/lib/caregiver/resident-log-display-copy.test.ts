import { describe, expect, it } from "vitest";

import {
  CAREGIVER_RESIDENT_LOG_NO_NOTES_COPY,
  formatCaregiverResidentLogGeneralNotes,
} from "./resident-log-display-copy";

describe("formatCaregiverResidentLogGeneralNotes", () => {
  it("names the gap when general notes are missing", () => {
    expect(formatCaregiverResidentLogGeneralNotes(null)).toBe(CAREGIVER_RESIDENT_LOG_NO_NOTES_COPY);
    expect(formatCaregiverResidentLogGeneralNotes(undefined)).toBe(CAREGIVER_RESIDENT_LOG_NO_NOTES_COPY);
  });

  it("names the gap when general notes are blank or whitespace only", () => {
    expect(formatCaregiverResidentLogGeneralNotes("")).toBe(CAREGIVER_RESIDENT_LOG_NO_NOTES_COPY);
    expect(formatCaregiverResidentLogGeneralNotes("   ")).toBe(CAREGIVER_RESIDENT_LOG_NO_NOTES_COPY);
    expect(formatCaregiverResidentLogGeneralNotes("\n\t  \n")).toBe(CAREGIVER_RESIDENT_LOG_NO_NOTES_COPY);
  });

  it("names the gap when general notes are a silent em dash", () => {
    expect(formatCaregiverResidentLogGeneralNotes("—")).toBe(CAREGIVER_RESIDENT_LOG_NO_NOTES_COPY);
    expect(formatCaregiverResidentLogGeneralNotes("  —  ")).toBe(CAREGIVER_RESIDENT_LOG_NO_NOTES_COPY);
  });

  it("returns trimmed posted notes as-is", () => {
    expect(formatCaregiverResidentLogGeneralNotes("Slept well after dinner.")).toBe("Slept well after dinner.");
    expect(formatCaregiverResidentLogGeneralNotes("  Ate breakfast.  ")).toBe("Ate breakfast.");
  });
});
