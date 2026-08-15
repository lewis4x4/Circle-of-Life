import { describe, expect, it } from "vitest";

import {
  MORNING_HUDDLE_NO_NAME_POSTED_COPY,
  MORNING_HUDDLE_NO_RESIDENT_POSTED_COPY,
  MORNING_HUDDLE_NO_STAFF_POSTED_COPY,
  formatMorningHuddleResidentName,
  formatMorningHuddleStaffName,
} from "./morning-huddle-display-copy";

const EM_DASH = "—";

describe("formatMorningHuddleResidentName", () => {
  it("names a missing resident join instead of Unknown or an em dash", () => {
    expect(formatMorningHuddleResidentName(null)).toBe(MORNING_HUDDLE_NO_RESIDENT_POSTED_COPY);
    expect(formatMorningHuddleResidentName(undefined)).toBe(MORNING_HUDDLE_NO_RESIDENT_POSTED_COPY);
    expect(formatMorningHuddleResidentName(null)).not.toBe("Unknown");
    expect(formatMorningHuddleResidentName(null)).not.toBe(EM_DASH);
  });

  it("names a blank resident instead of Unknown or an em dash", () => {
    expect(formatMorningHuddleResidentName({ first_name: "", last_name: "" })).toBe(
      MORNING_HUDDLE_NO_NAME_POSTED_COPY,
    );
    expect(formatMorningHuddleResidentName({ first_name: "  ", last_name: "" })).toBe(
      MORNING_HUDDLE_NO_NAME_POSTED_COPY,
    );
    expect(formatMorningHuddleResidentName({ first_name: "", last_name: "" })).not.toBe("Unknown");
  });

  it("names an em dash resident instead of a silent dash", () => {
    expect(formatMorningHuddleResidentName({ first_name: EM_DASH, last_name: "" })).toBe(
      MORNING_HUDDLE_NO_NAME_POSTED_COPY,
    );
    expect(formatMorningHuddleResidentName({ first_name: `  ${EM_DASH}  `, last_name: "" })).toBe(
      MORNING_HUDDLE_NO_NAME_POSTED_COPY,
    );
  });

  it("names legacy Unknown instead of repeating Unknown", () => {
    expect(formatMorningHuddleResidentName({ first_name: "Unknown", last_name: "" })).toBe(
      MORNING_HUDDLE_NO_NAME_POSTED_COPY,
    );
    expect(formatMorningHuddleResidentName({ first_name: "Unknown", last_name: "Unknown" })).toBe(
      MORNING_HUDDLE_NO_NAME_POSTED_COPY,
    );
  });

  it("returns a posted resident name trimmed", () => {
    expect(formatMorningHuddleResidentName({ first_name: "Jordan", last_name: "Lee" })).toBe(
      "Jordan Lee",
    );
    expect(
      formatMorningHuddleResidentName({ first_name: "  Jordan  ", last_name: "  Lee  " }),
    ).toBe("Jordan Lee");
  });
});

describe("formatMorningHuddleStaffName", () => {
  it("names a missing staff join instead of Unknown or an em dash", () => {
    expect(formatMorningHuddleStaffName(null)).toBe(MORNING_HUDDLE_NO_STAFF_POSTED_COPY);
    expect(formatMorningHuddleStaffName(undefined)).toBe(MORNING_HUDDLE_NO_STAFF_POSTED_COPY);
    expect(formatMorningHuddleStaffName(null)).not.toBe("Unknown");
    expect(formatMorningHuddleStaffName(null)).not.toBe(EM_DASH);
  });

  it("names a blank staff name instead of Unknown or an em dash", () => {
    expect(formatMorningHuddleStaffName({ first_name: "", last_name: "" })).toBe(
      MORNING_HUDDLE_NO_NAME_POSTED_COPY,
    );
    expect(formatMorningHuddleStaffName({ first_name: "  ", last_name: "" })).toBe(
      MORNING_HUDDLE_NO_NAME_POSTED_COPY,
    );
    expect(formatMorningHuddleStaffName({ first_name: "", last_name: "" })).not.toBe("Unknown");
  });

  it("names an em dash staff name instead of a silent dash", () => {
    expect(formatMorningHuddleStaffName({ first_name: EM_DASH, last_name: "" })).toBe(
      MORNING_HUDDLE_NO_NAME_POSTED_COPY,
    );
    expect(formatMorningHuddleStaffName({ first_name: `  ${EM_DASH}  `, last_name: "" })).toBe(
      MORNING_HUDDLE_NO_NAME_POSTED_COPY,
    );
  });

  it("names legacy Unknown instead of repeating Unknown", () => {
    expect(formatMorningHuddleStaffName({ first_name: "Unknown", last_name: "" })).toBe(
      MORNING_HUDDLE_NO_NAME_POSTED_COPY,
    );
    expect(formatMorningHuddleStaffName({ first_name: "Unknown", last_name: "Unknown" })).toBe(
      MORNING_HUDDLE_NO_NAME_POSTED_COPY,
    );
  });

  it("returns a posted staff name trimmed", () => {
    expect(formatMorningHuddleStaffName({ first_name: "Jordan", last_name: "Lee" })).toBe(
      "Jordan Lee",
    );
    expect(
      formatMorningHuddleStaffName({ first_name: "  Jordan  ", last_name: "  Lee  " }),
    ).toBe("Jordan Lee");
  });
});
