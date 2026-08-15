import { describe, expect, it } from "vitest";

import {
  INSPECTION_LOG_NO_VEHICLE_COPY,
  formatInspectionLogVehicleDisplayName,
} from "./inspection-log-display-copy";

const EM_DASH = "—";

describe("formatInspectionLogVehicleDisplayName", () => {
  it("names a missing fleet vehicle instead of generic unknown copy", () => {
    expect(formatInspectionLogVehicleDisplayName(null)).toBe(INSPECTION_LOG_NO_VEHICLE_COPY);
    expect(formatInspectionLogVehicleDisplayName(undefined)).toBe(INSPECTION_LOG_NO_VEHICLE_COPY);
    expect(formatInspectionLogVehicleDisplayName(null)).not.toBe("Unknown");
  });

  it("names a fleet vehicle with a blank posted name", () => {
    expect(formatInspectionLogVehicleDisplayName({ name: "" })).toBe(INSPECTION_LOG_NO_VEHICLE_COPY);
    expect(formatInspectionLogVehicleDisplayName({ name: "   " })).toBe(
      INSPECTION_LOG_NO_VEHICLE_COPY,
    );
  });

  it("names a fleet vehicle with an em dash posted name", () => {
    expect(formatInspectionLogVehicleDisplayName({ name: EM_DASH })).toBe(
      INSPECTION_LOG_NO_VEHICLE_COPY,
    );
    expect(formatInspectionLogVehicleDisplayName({ name: `  ${EM_DASH}  ` })).toBe(
      INSPECTION_LOG_NO_VEHICLE_COPY,
    );
  });

  it("maps legacy Unknown field values to the named gap copy", () => {
    expect(formatInspectionLogVehicleDisplayName({ name: "Unknown" })).toBe(
      INSPECTION_LOG_NO_VEHICLE_COPY,
    );
    expect(formatInspectionLogVehicleDisplayName({ name: "  Unknown  " })).toBe(
      INSPECTION_LOG_NO_VEHICLE_COPY,
    );
    expect(formatInspectionLogVehicleDisplayName({ name: "unknown" })).toBe(
      INSPECTION_LOG_NO_VEHICLE_COPY,
    );
  });

  it("returns a posted vehicle name trimmed as-is", () => {
    expect(formatInspectionLogVehicleDisplayName({ name: "Van 12" })).toBe("Van 12");
    expect(formatInspectionLogVehicleDisplayName({ name: "  Van 12  " })).toBe("Van 12");
  });
});
