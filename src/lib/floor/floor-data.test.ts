import { describe, expect, it } from "vitest";

import { floorRoomLabel } from "./floor-data";

describe("floorRoomLabel", () => {
  it("shows the room number alone in a single room", () => {
    expect(floorRoomLabel({ roomNumber: "101", bedLabel: "A", bedsInRoom: 1 })).toBe("101");
  });

  it("adds the bed only when the room has more than one bed", () => {
    expect(floorRoomLabel({ roomNumber: "102", bedLabel: "A", bedsInRoom: 2 })).toBe("102-A");
    expect(floorRoomLabel({ roomNumber: " 102 ", bedLabel: " B ", bedsInRoom: 3 })).toBe("102-B");
  });

  it("keeps the room alone when a shared room's bed has no label", () => {
    expect(floorRoomLabel({ roomNumber: "103", bedLabel: null, bedsInRoom: 2 })).toBe("103");
    expect(floorRoomLabel({ roomNumber: "103", bedLabel: "  ", bedsInRoom: 2 })).toBe("103");
  });

  it("says nothing when no room is on record", () => {
    expect(floorRoomLabel({ roomNumber: null, bedLabel: "A", bedsInRoom: 2 })).toBeNull();
    expect(floorRoomLabel({ roomNumber: "  ", bedLabel: "A", bedsInRoom: 1 })).toBeNull();
  });
});
