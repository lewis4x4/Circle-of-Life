import { describe, expect, it } from "vitest";
import { buildOutOfHouse, sinceLabel, sortOutOfHouse } from "./out-of-house";
import type { ResidentRow } from "./load-residents";

const resident = (patch: Partial<ResidentRow>): ResidentRow => ({
  id: "r", name: "Test Resident", initials: "TR", room: "101-A", unit: "", acuity: 1, acuityLevel: null, adlStatus: "independent", status: "active", careSummary: "", updatedAtIso: null, ...patch,
});

describe("out of house", () => {
  it("keeps only hospital and leave residents, labelled from the presence source, with the current status since date", () => {
    const rows = buildOutOfHouse(
      [
        resident({ id: "a", name: "Test Resident A", status: "active" }),
        resident({ id: "b", name: "Test Resident B", status: "loa", room: "102-B" }),
        resident({ id: "c", name: "Test Resident C", status: "hospital" }),
      ],
      [
        { resident_id: "b", effective_from: "2026-09-10T14:00:00Z" },
        { resident_id: "c", effective_from: "2026-09-12T09:00:00Z" },
      ],
    );
    expect(rows.map((row) => row.id)).toEqual(["c", "b"]);
    expect(rows[0]).toMatchObject({ label: "Bed Hold — Hospital", since: "2026-09-12T09:00:00Z", room: "101-A" });
    expect(rows[1]).toMatchObject({ label: "On leave / vacation", since: "2026-09-10T14:00:00Z" });
  });
  it("sorts hospital first, then leave, then the longest away, with unknown dates last", () => {
    const rows = sortOutOfHouse([
      { id: "1", name: "Test Resident D", room: "1", status: "loa", label: "", since: "2026-09-01T00:00:00Z" },
      { id: "2", name: "Test Resident E", room: "2", status: "hospital", label: "", since: null },
      { id: "3", name: "Test Resident F", room: "3", status: "hospital", label: "", since: "2026-09-05T00:00:00Z" },
      { id: "4", name: "Test Resident G", room: "4", status: "hospital", label: "", since: "2026-09-02T00:00:00Z" },
    ]);
    expect(rows.map((row) => row.id)).toEqual(["4", "3", "2", "1"]);
  });
  it("labels the since date in Eastern time and says when none is recorded", () => {
    expect(sinceLabel("2026-09-12T03:30:00Z")).toBe("Sep 11");
    expect(sinceLabel(null)).toBe("Not recorded");
  });
});
