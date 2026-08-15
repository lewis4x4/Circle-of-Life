import { describe, expect, it } from "vitest";

import {
  CAREGIVER_FACILITY_RESIDENT_NO_ROOM_COPY,
  formatCaregiverFacilityResidentRoomLabel,
} from "./facility-residents-display-copy";

describe("formatCaregiverFacilityResidentRoomLabel", () => {
  it("names the gap when room data is missing", () => {
    expect(formatCaregiverFacilityResidentRoomLabel(null)).toBe(
      CAREGIVER_FACILITY_RESIDENT_NO_ROOM_COPY,
    );
    expect(formatCaregiverFacilityResidentRoomLabel(undefined)).toBe(
      CAREGIVER_FACILITY_RESIDENT_NO_ROOM_COPY,
    );
    expect(formatCaregiverFacilityResidentRoomLabel(null, "A")).toBe(
      CAREGIVER_FACILITY_RESIDENT_NO_ROOM_COPY,
    );
  });

  it("names the gap when room data is blank or a silent dash", () => {
    expect(formatCaregiverFacilityResidentRoomLabel("")).toBe(
      CAREGIVER_FACILITY_RESIDENT_NO_ROOM_COPY,
    );
    expect(formatCaregiverFacilityResidentRoomLabel("   ")).toBe(
      CAREGIVER_FACILITY_RESIDENT_NO_ROOM_COPY,
    );
    expect(formatCaregiverFacilityResidentRoomLabel("—")).toBe(
      CAREGIVER_FACILITY_RESIDENT_NO_ROOM_COPY,
    );
    expect(formatCaregiverFacilityResidentRoomLabel("", "A")).toBe(
      CAREGIVER_FACILITY_RESIDENT_NO_ROOM_COPY,
    );
  });

  it("returns posted room labels trimmed as-is", () => {
    expect(formatCaregiverFacilityResidentRoomLabel("12A")).toBe("12A");
    expect(formatCaregiverFacilityResidentRoomLabel("  12A  ")).toBe("12A");
    expect(formatCaregiverFacilityResidentRoomLabel("12A", "B")).toBe("12A-B");
    expect(formatCaregiverFacilityResidentRoomLabel("12A", null)).toBe("12A");
    expect(formatCaregiverFacilityResidentRoomLabel("12A", "  B  ")).toBe("12A-B");
  });
});
