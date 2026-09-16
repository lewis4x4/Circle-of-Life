import { describe, expect, it } from "vitest";

import {
  formatIncidentFollowupDue,
  formatIncidentOccurredAt,
  formatIncidentResidentName,
  formatLevelWord,
  INCIDENTS_NO_DATE_POSTED_COPY,
  INCIDENTS_NO_LEVEL_POSTED_COPY,
  INCIDENTS_NO_NAME_POSTED_COPY,
  INCIDENTS_NO_RESIDENT_POSTED_COPY,
  levelNumberFromSeverity,
} from "./incidents-display-copy";

const PARSEABLE_ISO = "2026-08-15T14:00:00.000Z";

describe("formatIncidentOccurredAt", () => {
  it("formats a posted occurred-at timestamp", () => {
    const formatted = formatIncidentOccurredAt(PARSEABLE_ISO);
    expect(formatted).toMatch(/Aug/);
    expect(formatted).toMatch(/15/);
    expect(formatted).not.toBe(INCIDENTS_NO_DATE_POSTED_COPY);
  });

  it("names the gap when occurred-at is missing or blank", () => {
    expect(formatIncidentOccurredAt(null)).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
    expect(formatIncidentOccurredAt(undefined)).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
    expect(formatIncidentOccurredAt("")).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
    expect(formatIncidentOccurredAt("   ")).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
  });

  it("names the gap for invalid date strings", () => {
    expect(formatIncidentOccurredAt("not-a-date")).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
  });

  it("names the gap for em dash input", () => {
    expect(formatIncidentOccurredAt("—")).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
    expect(formatIncidentOccurredAt("  —  ")).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
  });

  it("names the gap for legacy Unknown input", () => {
    expect(formatIncidentOccurredAt("Unknown")).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
    expect(formatIncidentOccurredAt("  Unknown  ")).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
  });

  it("never surfaces Unknown or a lone em dash", () => {
    expect(INCIDENTS_NO_DATE_POSTED_COPY).toBe("No date posted");
    expect(formatIncidentOccurredAt(null)).not.toBe("Unknown");
    expect(formatIncidentOccurredAt(null)).not.toBe("—");
  });
});

describe("formatIncidentFollowupDue", () => {
  it("formats a posted follow-up due timestamp", () => {
    const formatted = formatIncidentFollowupDue(PARSEABLE_ISO);
    expect(formatted).toMatch(/Aug/);
    expect(formatted).toMatch(/15/);
    expect(formatted).not.toBe(INCIDENTS_NO_DATE_POSTED_COPY);
  });

  it("names the gap when follow-up due is missing or blank", () => {
    expect(formatIncidentFollowupDue(null)).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
    expect(formatIncidentFollowupDue(undefined)).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
    expect(formatIncidentFollowupDue("")).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
    expect(formatIncidentFollowupDue("   ")).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
  });

  it("names the gap for invalid date strings", () => {
    expect(formatIncidentFollowupDue("not-a-date")).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
  });

  it("names the gap for em dash input", () => {
    expect(formatIncidentFollowupDue("—")).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
    expect(formatIncidentFollowupDue("  —  ")).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
  });

  it("names the gap for legacy Unknown input", () => {
    expect(formatIncidentFollowupDue("Unknown")).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
    expect(formatIncidentFollowupDue("  Unknown  ")).toBe(INCIDENTS_NO_DATE_POSTED_COPY);
  });

  it("never surfaces Unknown or a lone em dash", () => {
    expect(formatIncidentFollowupDue(null)).not.toBe("Unknown");
    expect(formatIncidentFollowupDue(null)).not.toBe("—");
  });
});

describe("formatIncidentResidentName", () => {
  it("names the gap when resident join is missing", () => {
    expect(formatIncidentResidentName(null)).toBe(INCIDENTS_NO_RESIDENT_POSTED_COPY);
    expect(formatIncidentResidentName(undefined)).toBe(INCIDENTS_NO_RESIDENT_POSTED_COPY);
  });

  it("names the gap when posted first and last are blank or whitespace", () => {
    expect(formatIncidentResidentName({ first_name: null, last_name: null })).toBe(
      INCIDENTS_NO_NAME_POSTED_COPY,
    );
    expect(formatIncidentResidentName({ first_name: "", last_name: "" })).toBe(
      INCIDENTS_NO_NAME_POSTED_COPY,
    );
    expect(formatIncidentResidentName({ first_name: "   ", last_name: "  " })).toBe(
      INCIDENTS_NO_NAME_POSTED_COPY,
    );
  });

  it("names the gap for em dash and legacy generic resident strings", () => {
    expect(formatIncidentResidentName({ first_name: "—", last_name: null })).toBe(
      INCIDENTS_NO_NAME_POSTED_COPY,
    );
    expect(formatIncidentResidentName({ first_name: "Unknown", last_name: null })).toBe(
      INCIDENTS_NO_NAME_POSTED_COPY,
    );
    expect(formatIncidentResidentName({ first_name: "Unknown", last_name: "resident" })).toBe(
      INCIDENTS_NO_NAME_POSTED_COPY,
    );
    expect(formatIncidentResidentName({ first_name: "Unknown", last_name: "Resident" })).toBe(
      INCIDENTS_NO_NAME_POSTED_COPY,
    );
    expect(formatIncidentResidentName({ first_name: "Unnamed", last_name: null })).toBe(
      INCIDENTS_NO_NAME_POSTED_COPY,
    );
    expect(formatIncidentResidentName({ first_name: "Unnamed", last_name: "resident" })).toBe(
      INCIDENTS_NO_NAME_POSTED_COPY,
    );
  });

  it("keeps a posted resident name", () => {
    expect(formatIncidentResidentName({ first_name: "Resident", last_name: "Alpha" })).toBe(
      "Resident Alpha",
    );
    expect(formatIncidentResidentName({ first_name: "Resident", last_name: null })).toBe("Resident");
    expect(formatIncidentResidentName({ first_name: null, last_name: "Beta" })).toBe("Beta");
  });

  it("never surfaces Unknown, Unknown resident, or a lone em dash", () => {
    expect(INCIDENTS_NO_RESIDENT_POSTED_COPY).toBe("No resident posted");
    expect(INCIDENTS_NO_NAME_POSTED_COPY).toBe("No name posted");
    expect(formatIncidentResidentName(null)).not.toBe("Unknown");
    expect(formatIncidentResidentName(null)).not.toBe("Unknown resident");
    expect(formatIncidentResidentName(null)).not.toBe("Unknown Resident");
    expect(formatIncidentResidentName(null)).not.toBe("—");
    expect(formatIncidentResidentName({ first_name: "Unknown", last_name: null })).not.toBe("Unknown");
    expect(formatIncidentResidentName({ first_name: "—", last_name: null })).not.toBe("—");
  });
});

describe("levelNumberFromSeverity", () => {
  it("accepts level_n, the digit string, and the number", () => {
    expect(levelNumberFromSeverity("level_1")).toBe(1);
    expect(levelNumberFromSeverity("level_4")).toBe(4);
    expect(levelNumberFromSeverity("2")).toBe(2);
    expect(levelNumberFromSeverity(" 3 ")).toBe(3);
    expect(levelNumberFromSeverity(3)).toBe(3);
  });

  it("returns null for anything outside 1..4", () => {
    expect(levelNumberFromSeverity(null)).toBeNull();
    expect(levelNumberFromSeverity(undefined)).toBeNull();
    expect(levelNumberFromSeverity("")).toBeNull();
    expect(levelNumberFromSeverity("level_5")).toBeNull();
    expect(levelNumberFromSeverity("level_0")).toBeNull();
    expect(levelNumberFromSeverity("5")).toBeNull();
    expect(levelNumberFromSeverity(0)).toBeNull();
    expect(levelNumberFromSeverity(2.5)).toBeNull();
    expect(levelNumberFromSeverity("high")).toBeNull();
    expect(levelNumberFromSeverity("—")).toBeNull();
  });
});

describe("formatLevelWord", () => {
  it("names each level in plain words", () => {
    expect(formatLevelWord(1)).toBe("Note");
    expect(formatLevelWord(2)).toBe("Heads-up");
    expect(formatLevelWord(3)).toBe("Urgent");
    expect(formatLevelWord(4)).toBe("Emergency");
    expect(formatLevelWord("level_1")).toBe("Note");
    expect(formatLevelWord("level_2")).toBe("Heads-up");
    expect(formatLevelWord("level_3")).toBe("Urgent");
    expect(formatLevelWord("level_4")).toBe("Emergency");
    expect(formatLevelWord("1")).toBe("Note");
    expect(formatLevelWord("4")).toBe("Emergency");
  });

  it("names the gap for anything else", () => {
    expect(INCIDENTS_NO_LEVEL_POSTED_COPY).toBe("No level posted");
    expect(formatLevelWord(null)).toBe(INCIDENTS_NO_LEVEL_POSTED_COPY);
    expect(formatLevelWord(undefined)).toBe(INCIDENTS_NO_LEVEL_POSTED_COPY);
    expect(formatLevelWord("")).toBe(INCIDENTS_NO_LEVEL_POSTED_COPY);
    expect(formatLevelWord("level_9")).toBe(INCIDENTS_NO_LEVEL_POSTED_COPY);
    expect(formatLevelWord(0)).toBe(INCIDENTS_NO_LEVEL_POSTED_COPY);
    expect(formatLevelWord("critical")).toBe(INCIDENTS_NO_LEVEL_POSTED_COPY);
    expect(formatLevelWord(null)).not.toBe("Unknown");
    expect(formatLevelWord(null)).not.toBe("—");
  });
});
