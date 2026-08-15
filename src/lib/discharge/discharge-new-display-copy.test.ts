import { describe, expect, it } from "vitest";

import {
  DISCHARGE_NEW_NO_DATE_COPY,
  DISCHARGE_NEW_NO_NAME_POSTED_COPY,
  DISCHARGE_NEW_NO_RESIDENT_POSTED_COPY,
  DISCHARGE_NEW_NO_ROOM_COPY,
  formatDischargeNewResidentLabel,
  formatDischargeNewRoomLabel,
  formatDischargeNewStartedLabel,
  getDischargeNewStartedDaysAgo,
} from "./discharge-new-display-copy";

const EM_DASH = "—";

describe("formatDischargeNewResidentLabel", () => {
  it("names a missing resident join", () => {
    expect(formatDischargeNewResidentLabel(null)).toBe(DISCHARGE_NEW_NO_RESIDENT_POSTED_COPY);
    expect(formatDischargeNewResidentLabel(undefined)).toBe(DISCHARGE_NEW_NO_RESIDENT_POSTED_COPY);
  });

  it("names blank posted names", () => {
    expect(formatDischargeNewResidentLabel({ first_name: "", last_name: "" })).toBe(
      DISCHARGE_NEW_NO_NAME_POSTED_COPY,
    );
    expect(formatDischargeNewResidentLabel({ first_name: "   ", last_name: "  " })).toBe(
      DISCHARGE_NEW_NO_NAME_POSTED_COPY,
    );
  });

  it("names em dash and legacy generic placeholders", () => {
    expect(formatDischargeNewResidentLabel({ first_name: EM_DASH, last_name: "" })).toBe(
      DISCHARGE_NEW_NO_NAME_POSTED_COPY,
    );
    expect(formatDischargeNewResidentLabel({ first_name: "Unknown", last_name: "" })).toBe(
      DISCHARGE_NEW_NO_NAME_POSTED_COPY,
    );
    expect(formatDischargeNewResidentLabel({ first_name: "Unknown resident", last_name: "" })).toBe(
      DISCHARGE_NEW_NO_NAME_POSTED_COPY,
    );
    expect(formatDischargeNewResidentLabel({ first_name: "Unknown Resident", last_name: "" })).toBe(
      DISCHARGE_NEW_NO_NAME_POSTED_COPY,
    );
    expect(formatDischargeNewResidentLabel({ first_name: "Unnamed", last_name: "" })).toBe(
      DISCHARGE_NEW_NO_NAME_POSTED_COPY,
    );
    expect(formatDischargeNewResidentLabel({ first_name: "Unnamed resident", last_name: "" })).toBe(
      DISCHARGE_NEW_NO_NAME_POSTED_COPY,
    );
  });

  it.each([
    ["Unknown", ""],
    ["Unknown resident", ""],
    ["Unknown", "resident"],
    ["Unknown", "Resident"],
    ["Unnamed", ""],
    ["Unnamed resident", ""],
    ["Unnamed", "resident"],
  ] as const)("names legacy generic placeholder %j %j", (first_name, last_name) => {
    expect(formatDischargeNewResidentLabel({ first_name, last_name })).toBe(
      DISCHARGE_NEW_NO_NAME_POSTED_COPY,
    );
  });

  it("keeps a posted last-name-first label", () => {
    expect(formatDischargeNewResidentLabel({ first_name: "Posted", last_name: "Record" })).toBe(
      "Record, Posted",
    );
    expect(formatDischargeNewResidentLabel({ first_name: "  Posted  ", last_name: "  Record  " })).toBe(
      "Record, Posted",
    );
  });

  it("returns a single posted part with no dangling comma", () => {
    expect(formatDischargeNewResidentLabel({ first_name: "Posted", last_name: "" })).toBe("Posted");
    expect(formatDischargeNewResidentLabel({ first_name: "", last_name: "Record" })).toBe("Record");
    expect(formatDischargeNewResidentLabel({ first_name: "Posted", last_name: null })).toBe("Posted");
    expect(formatDischargeNewResidentLabel({ first_name: null, last_name: "Record" })).toBe("Record");
  });

  it("never surfaces Unknown, Unknown resident, a lone em dash, or a dangling comma", () => {
    const samples = [
      null,
      undefined,
      { first_name: "", last_name: "" },
      { first_name: EM_DASH, last_name: "" },
      { first_name: "Unknown", last_name: "resident" },
      { first_name: "Posted", last_name: "Record" },
      { first_name: "Posted", last_name: "" },
      { first_name: "", last_name: "Record" },
    ] as const;
    const forbidden = ["—", "Unknown", "Unknown resident", "Unknown Resident", ","];
    for (const sample of samples) {
      const result = formatDischargeNewResidentLabel(sample);
      for (const bad of forbidden) {
        expect(result).not.toBe(bad);
      }
      expect(result).not.toMatch(/^,\s/);
      expect(result).not.toMatch(/,\s*$/);
    }
  });
});

describe("formatDischargeNewRoomLabel", () => {
  it("names a missing or blank room and bed", () => {
    expect(formatDischargeNewRoomLabel(null, null)).toBe(DISCHARGE_NEW_NO_ROOM_COPY);
    expect(formatDischargeNewRoomLabel(undefined, undefined)).toBe(DISCHARGE_NEW_NO_ROOM_COPY);
    expect(formatDischargeNewRoomLabel("", "")).toBe(DISCHARGE_NEW_NO_ROOM_COPY);
    expect(formatDischargeNewRoomLabel("   ", "  ")).toBe(DISCHARGE_NEW_NO_ROOM_COPY);
  });

  it("names em dash and legacy generic placeholders", () => {
    expect(formatDischargeNewRoomLabel(EM_DASH, null)).toBe(DISCHARGE_NEW_NO_ROOM_COPY);
    expect(formatDischargeNewRoomLabel("Unknown", null)).toBe(DISCHARGE_NEW_NO_ROOM_COPY);
    expect(formatDischargeNewRoomLabel("Unassigned", null)).toBe(DISCHARGE_NEW_NO_ROOM_COPY);
    expect(formatDischargeNewRoomLabel("Unnamed", null)).toBe(DISCHARGE_NEW_NO_ROOM_COPY);
    expect(formatDischargeNewRoomLabel(null, "Unassigned")).toBe(DISCHARGE_NEW_NO_ROOM_COPY);
    expect(formatDischargeNewRoomLabel(null, EM_DASH)).toBe(DISCHARGE_NEW_NO_ROOM_COPY);
    expect(formatDischargeNewRoomLabel(" unknown ", " unassigned ")).toBe(DISCHARGE_NEW_NO_ROOM_COPY);
  });

  it("prefers a posted room number over bed label", () => {
    expect(formatDischargeNewRoomLabel("Posted Room", "Posted Bed")).toBe("Posted Room");
    expect(formatDischargeNewRoomLabel("  Posted Room  ", "Posted Bed")).toBe("Posted Room");
  });

  it("falls back to a posted bed label when room number is missing", () => {
    expect(formatDischargeNewRoomLabel(null, "Posted Bed")).toBe("Posted Bed");
    expect(formatDischargeNewRoomLabel("", "  Posted Bed  ")).toBe("Posted Bed");
    expect(formatDischargeNewRoomLabel("Unknown", "Posted Bed")).toBe("Posted Bed");
  });

  it("never surfaces a lone em dash for resident picker room labels", () => {
    const samples = [
      [null, null],
      [undefined, undefined],
      ["", ""],
      [EM_DASH, null],
      ["Unknown", "Unassigned"],
      ["Posted Room", "Posted Bed"],
      [null, "Posted Bed"],
    ] as const;
    for (const [roomNumber, bedLabel] of samples) {
      expect(formatDischargeNewRoomLabel(roomNumber, bedLabel)).not.toBe(EM_DASH);
    }
  });
});

describe("formatDischargeNewStartedLabel", () => {
  it("names a missing or blank posted timestamp", () => {
    expect(formatDischargeNewStartedLabel(null)).toBe(DISCHARGE_NEW_NO_DATE_COPY);
    expect(formatDischargeNewStartedLabel(undefined)).toBe(DISCHARGE_NEW_NO_DATE_COPY);
    expect(formatDischargeNewStartedLabel("")).toBe(DISCHARGE_NEW_NO_DATE_COPY);
    expect(formatDischargeNewStartedLabel("   ")).toBe(DISCHARGE_NEW_NO_DATE_COPY);
  });

  it("names em dash and Unknown placeholders", () => {
    expect(formatDischargeNewStartedLabel(EM_DASH)).toBe(DISCHARGE_NEW_NO_DATE_COPY);
    expect(formatDischargeNewStartedLabel("Unknown")).toBe(DISCHARGE_NEW_NO_DATE_COPY);
    expect(formatDischargeNewStartedLabel(" unknown ")).toBe(DISCHARGE_NEW_NO_DATE_COPY);
  });

  it("names unparseable values", () => {
    expect(formatDischargeNewStartedLabel("not-a-date")).toBe(DISCHARGE_NEW_NO_DATE_COPY);
  });

  it("formats a parseable ISO timestamp", () => {
    expect(formatDischargeNewStartedLabel("2026-01-15T12:00:00.000Z")).toBe("Jan 15, 2026");
    expect(formatDischargeNewStartedLabel("2026-01-15")).toBe("Jan 15, 2026");
  });

  it("never surfaces a lone em dash for draft started labels", () => {
    const samples = [null, undefined, "", EM_DASH, "Unknown", "not-a-date", "2026-01-15T12:00:00.000Z"] as const;
    for (const sample of samples) {
      expect(formatDischargeNewStartedLabel(sample)).not.toBe(EM_DASH);
    }
  });
});

describe("getDischargeNewStartedDaysAgo", () => {
  const reference = new Date("2026-01-20T12:00:00.000Z");

  it("returns 0 when the posted timestamp is missing or unparseable", () => {
    expect(getDischargeNewStartedDaysAgo(null, reference)).toBe(0);
    expect(getDischargeNewStartedDaysAgo("", reference)).toBe(0);
    expect(getDischargeNewStartedDaysAgo(EM_DASH, reference)).toBe(0);
    expect(getDischargeNewStartedDaysAgo("Unknown", reference)).toBe(0);
    expect(getDischargeNewStartedDaysAgo("not-a-date", reference)).toBe(0);
  });

  it("counts calendar days from a parseable ISO timestamp", () => {
    expect(getDischargeNewStartedDaysAgo("2026-01-15T12:00:00.000Z", reference)).toBe(5);
    expect(getDischargeNewStartedDaysAgo("2026-01-15", reference)).toBe(5);
  });
});
