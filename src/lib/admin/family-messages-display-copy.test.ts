import { describe, expect, it } from "vitest";

import {
  FAMILY_MESSAGES_NO_AUTHOR_POSTED_COPY,
  FAMILY_MESSAGES_NO_NAME_POSTED_COPY,
  FAMILY_MESSAGES_NO_RESIDENT_POSTED_COPY,
  FAMILY_MESSAGES_NO_ROOM_POSTED_COPY,
  formatFamilyMessagesAuthorName,
  formatFamilyMessagesResidentLabel,
  formatFamilyMessagesRoomLabel,
} from "./family-messages-display-copy";

const EM_DASH = "—";

describe("formatFamilyMessagesResidentLabel", () => {
  it("names a missing resident instead of Unknown Resident", () => {
    expect(formatFamilyMessagesResidentLabel(null)).toBe(FAMILY_MESSAGES_NO_RESIDENT_POSTED_COPY);
    expect(formatFamilyMessagesResidentLabel(undefined)).toBe(FAMILY_MESSAGES_NO_RESIDENT_POSTED_COPY);
    expect(formatFamilyMessagesResidentLabel(null)).not.toBe("Unknown Resident");
  });

  it("names a blank resident name instead of inventing one", () => {
    expect(formatFamilyMessagesResidentLabel({ first_name: null, last_name: null })).toBe(
      FAMILY_MESSAGES_NO_NAME_POSTED_COPY,
    );
    expect(formatFamilyMessagesResidentLabel({ first_name: "", last_name: "" })).toBe(
      FAMILY_MESSAGES_NO_NAME_POSTED_COPY,
    );
    expect(formatFamilyMessagesResidentLabel({ first_name: "   ", last_name: "  " })).toBe(
      FAMILY_MESSAGES_NO_NAME_POSTED_COPY,
    );
  });

  it("names an em dash resident name instead of a silent dash", () => {
    expect(formatFamilyMessagesResidentLabel({ first_name: EM_DASH, last_name: null })).toBe(
      FAMILY_MESSAGES_NO_NAME_POSTED_COPY,
    );
    expect(formatFamilyMessagesResidentLabel({ first_name: `  ${EM_DASH}  `, last_name: "" })).toBe(
      FAMILY_MESSAGES_NO_NAME_POSTED_COPY,
    );
  });

  it("returns a posted resident name trimmed", () => {
    expect(formatFamilyMessagesResidentLabel({ first_name: "Jordan", last_name: "Lee" })).toBe(
      "Jordan Lee",
    );
    expect(formatFamilyMessagesResidentLabel({ first_name: "  Jordan  ", last_name: " Lee " })).toBe(
      "Jordan Lee",
    );
  });
});

describe("formatFamilyMessagesRoomLabel", () => {
  it("names a missing room instead of a silent dash", () => {
    expect(formatFamilyMessagesRoomLabel(null)).toBe(FAMILY_MESSAGES_NO_ROOM_POSTED_COPY);
    expect(formatFamilyMessagesRoomLabel(undefined)).toBe(FAMILY_MESSAGES_NO_ROOM_POSTED_COPY);
    expect(formatFamilyMessagesRoomLabel(null)).not.toBe(EM_DASH);
  });

  it("names a blank room instead of a silent dash", () => {
    expect(formatFamilyMessagesRoomLabel("")).toBe(FAMILY_MESSAGES_NO_ROOM_POSTED_COPY);
    expect(formatFamilyMessagesRoomLabel("   ")).toBe(FAMILY_MESSAGES_NO_ROOM_POSTED_COPY);
    expect(formatFamilyMessagesRoomLabel("")).not.toBe(EM_DASH);
  });

  it("names an em dash room instead of a silent dash", () => {
    expect(formatFamilyMessagesRoomLabel(EM_DASH)).toBe(FAMILY_MESSAGES_NO_ROOM_POSTED_COPY);
    expect(formatFamilyMessagesRoomLabel(`  ${EM_DASH}  `)).toBe(FAMILY_MESSAGES_NO_ROOM_POSTED_COPY);
  });

  it("returns a posted room label trimmed", () => {
    expect(formatFamilyMessagesRoomLabel("Room 12")).toBe("Room 12");
    expect(formatFamilyMessagesRoomLabel("  Room 12  ")).toBe("Room 12");
  });
});

describe("formatFamilyMessagesAuthorName", () => {
  it("names a missing author instead of Unknown", () => {
    expect(formatFamilyMessagesAuthorName(null)).toBe(FAMILY_MESSAGES_NO_AUTHOR_POSTED_COPY);
    expect(formatFamilyMessagesAuthorName(undefined)).toBe(FAMILY_MESSAGES_NO_AUTHOR_POSTED_COPY);
    expect(formatFamilyMessagesAuthorName(null)).not.toBe("Unknown");
  });

  it("names a blank author instead of Unknown", () => {
    expect(formatFamilyMessagesAuthorName("")).toBe(FAMILY_MESSAGES_NO_AUTHOR_POSTED_COPY);
    expect(formatFamilyMessagesAuthorName("   ")).toBe(FAMILY_MESSAGES_NO_AUTHOR_POSTED_COPY);
    expect(formatFamilyMessagesAuthorName("")).not.toBe("Unknown");
  });

  it("names an em dash author instead of a silent dash", () => {
    expect(formatFamilyMessagesAuthorName(EM_DASH)).toBe(FAMILY_MESSAGES_NO_AUTHOR_POSTED_COPY);
    expect(formatFamilyMessagesAuthorName(`  ${EM_DASH}  `)).toBe(FAMILY_MESSAGES_NO_AUTHOR_POSTED_COPY);
  });

  it("returns a posted author name trimmed", () => {
    expect(formatFamilyMessagesAuthorName("Jordan Lee")).toBe("Jordan Lee");
    expect(formatFamilyMessagesAuthorName("  Jordan Lee  ")).toBe("Jordan Lee");
  });
});
