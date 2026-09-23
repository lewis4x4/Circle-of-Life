import { describe, expect, it } from "vitest";

import { enumLabel, enumOptions } from "@/lib/display/enum-label";

describe("enumLabel", () => {
  it("renders stored enum values as sentence-case words", () => {
    expect(enumLabel("wrong_medication")).toBe("Wrong medication");
    expect(enumLabel("near_miss")).toBe("Near miss");
    expect(enumLabel("AT_RISK")).toBe("At risk");
    expect(enumLabel("ROOM_AND_BOARD")).toBe("Room and board");
    expect(enumLabel("behavioral_resident_to_resident")).toBe("Behavioral resident to resident");
  });

  it("keeps acronyms as letters", () => {
    expect(enumLabel("uti")).toBe("UTI");
    expect(enumLabel("ceo")).toBe("CEO");
    expect(enumLabel("level_0_thin")).toBe("Level 0 thin");
    expect(enumLabel("prn_followup")).toBe("PRN followup");
  });

  it("uses the domain override before spelling", () => {
    expect(enumLabel("semi_private", { overrides: { semi_private: "Companion" } })).toBe("Companion");
    expect(enumLabel("SEMI_PRIVATE", { overrides: { semi_private: "Companion" } })).toBe("Companion");
  });

  it("title-cases on request and names an empty value", () => {
    expect(enumLabel("general_liability", { case: "title" })).toBe("General Liability");
    expect(enumLabel("wrong_medication", { case: "lower" })).toBe("wrong medication");
    expect(enumLabel("uti_follow_up", { case: "lower" })).toBe("UTI follow up");
    expect(enumLabel(null)).toBe("—");
    expect(enumLabel("  ", { empty: "Not set" })).toBe("Not set");
  });

  it("builds select options in order", () => {
    expect(enumOptions(["day", "evening"] as const)).toEqual([
      { value: "day", label: "Day" },
      { value: "evening", label: "Evening" },
    ]);
  });
});
