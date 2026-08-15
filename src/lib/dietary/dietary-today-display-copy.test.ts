import { describe, expect, it } from "vitest";

import {
  DIETARY_TODAY_NO_NAME_COPY,
  DIETARY_TODAY_NO_RESIDENT_COPY,
  DIETARY_TODAY_NO_ROOM_COPY,
  formatDietaryTodayCompactName,
  formatDietaryTodayResidentName,
  formatDietaryTodayRoom,
} from "./dietary-today-display-copy";

describe("formatDietaryTodayResidentName", () => {
  it("names a missing residents join instead of generic unknown copy", () => {
    expect(formatDietaryTodayResidentName(null)).toBe(DIETARY_TODAY_NO_RESIDENT_COPY);
    expect(formatDietaryTodayResidentName(undefined)).toBe(DIETARY_TODAY_NO_RESIDENT_COPY);
  });

  it("names blank posted names instead of inventing a label", () => {
    expect(formatDietaryTodayResidentName({ first_name: "", last_name: "" })).toBe(
      DIETARY_TODAY_NO_NAME_COPY,
    );
    expect(formatDietaryTodayResidentName({ first_name: "   ", last_name: "  " })).toBe(
      DIETARY_TODAY_NO_NAME_COPY,
    );
  });

  it("returns a trimmed last-name-first posted name", () => {
    expect(
      formatDietaryTodayResidentName({ first_name: "Jordan", last_name: "Lee" }),
    ).toBe("Lee, Jordan");
    expect(
      formatDietaryTodayResidentName({ first_name: "  Jordan  ", last_name: "  Lee  " }),
    ).toBe("Lee, Jordan");
  });
});

describe("formatDietaryTodayCompactName", () => {
  it("names a missing residents join instead of generic unknown copy", () => {
    expect(formatDietaryTodayCompactName(null)).toBe(DIETARY_TODAY_NO_RESIDENT_COPY);
    expect(formatDietaryTodayCompactName(undefined)).toBe(DIETARY_TODAY_NO_RESIDENT_COPY);
  });

  it("names blank posted names instead of inventing a label", () => {
    expect(formatDietaryTodayCompactName({ first_name: "", last_name: "" })).toBe(
      DIETARY_TODAY_NO_NAME_COPY,
    );
    expect(formatDietaryTodayCompactName({ first_name: "   ", last_name: "  " })).toBe(
      DIETARY_TODAY_NO_NAME_COPY,
    );
  });

  it("returns a trimmed last-name-first initial when posted", () => {
    expect(
      formatDietaryTodayCompactName({ first_name: "Jordan", last_name: "Lee" }),
    ).toBe("Lee, J.");
    expect(
      formatDietaryTodayCompactName({ first_name: "  Jordan  ", last_name: "  Lee  " }),
    ).toBe("Lee, J.");
  });
});

describe("formatDietaryTodayRoom", () => {
  it("names missing or placeholder room values instead of a hyphen", () => {
    expect(formatDietaryTodayRoom(null)).toBe(DIETARY_TODAY_NO_ROOM_COPY);
    expect(formatDietaryTodayRoom(undefined)).toBe(DIETARY_TODAY_NO_ROOM_COPY);
    expect(formatDietaryTodayRoom("")).toBe(DIETARY_TODAY_NO_ROOM_COPY);
    expect(formatDietaryTodayRoom("   ")).toBe(DIETARY_TODAY_NO_ROOM_COPY);
    expect(formatDietaryTodayRoom("-")).toBe(DIETARY_TODAY_NO_ROOM_COPY);
    expect(formatDietaryTodayRoom("—")).toBe(DIETARY_TODAY_NO_ROOM_COPY);
    expect(formatDietaryTodayRoom("–")).toBe(DIETARY_TODAY_NO_ROOM_COPY);
  });

  it("returns a trimmed posted room label", () => {
    expect(formatDietaryTodayRoom("Room 12")).toBe("Room 12");
    expect(formatDietaryTodayRoom("  Room 12  ")).toBe("Room 12");
  });
});
