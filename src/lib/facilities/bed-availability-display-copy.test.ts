import { describe, expect, it } from "vitest";

import {
  BED_AVAILABILITY_NO_ROOM_COPY,
  formatBedAvailabilityRoomNumber,
} from "./bed-availability-display-copy";

describe("formatBedAvailabilityRoomNumber", () => {
  it("names the gap when room data is missing", () => {
    expect(formatBedAvailabilityRoomNumber(null)).toBe(BED_AVAILABILITY_NO_ROOM_COPY);
    expect(formatBedAvailabilityRoomNumber(undefined)).toBe(BED_AVAILABILITY_NO_ROOM_COPY);
  });

  it("names the gap when room data is blank or a silent dash", () => {
    expect(formatBedAvailabilityRoomNumber("")).toBe(BED_AVAILABILITY_NO_ROOM_COPY);
    expect(formatBedAvailabilityRoomNumber("   ")).toBe(BED_AVAILABILITY_NO_ROOM_COPY);
    expect(formatBedAvailabilityRoomNumber("—")).toBe(BED_AVAILABILITY_NO_ROOM_COPY);
  });

  it("returns posted room numbers trimmed as-is", () => {
    expect(formatBedAvailabilityRoomNumber("12A")).toBe("12A");
    expect(formatBedAvailabilityRoomNumber("  12A  ")).toBe("12A");
  });
});
