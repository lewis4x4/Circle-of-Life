import { describe, expect, it } from "vitest";

import {
  VERBAL_ORDERS_NEW_NO_FACILITY_COPY,
  formatVerbalOrderFacilityName,
} from "./verbal-orders-new-display-copy";

const EM_DASH = "—";

describe("formatVerbalOrderFacilityName", () => {
  it("names the gap when facility name is missing", () => {
    expect(formatVerbalOrderFacilityName(null)).toBe(VERBAL_ORDERS_NEW_NO_FACILITY_COPY);
    expect(formatVerbalOrderFacilityName(undefined)).toBe(VERBAL_ORDERS_NEW_NO_FACILITY_COPY);
    expect(formatVerbalOrderFacilityName(null)).not.toBe(EM_DASH);
  });

  it("names the gap when facility name is blank", () => {
    expect(formatVerbalOrderFacilityName("")).toBe(VERBAL_ORDERS_NEW_NO_FACILITY_COPY);
    expect(formatVerbalOrderFacilityName("   ")).toBe(VERBAL_ORDERS_NEW_NO_FACILITY_COPY);
    expect(formatVerbalOrderFacilityName("")).not.toBe(EM_DASH);
  });

  it("names the gap when facility name is an em dash", () => {
    expect(formatVerbalOrderFacilityName(EM_DASH)).toBe(VERBAL_ORDERS_NEW_NO_FACILITY_COPY);
    expect(formatVerbalOrderFacilityName(`  ${EM_DASH}  `)).toBe(
      VERBAL_ORDERS_NEW_NO_FACILITY_COPY,
    );
    expect(formatVerbalOrderFacilityName(EM_DASH)).not.toBe(EM_DASH);
  });

  it("replaces legacy Unknown and Unknown facility copy with a named gap", () => {
    expect(formatVerbalOrderFacilityName("Unknown")).toBe(VERBAL_ORDERS_NEW_NO_FACILITY_COPY);
    expect(formatVerbalOrderFacilityName("  Unknown  ")).toBe(VERBAL_ORDERS_NEW_NO_FACILITY_COPY);
    expect(formatVerbalOrderFacilityName("Unknown facility")).toBe(
      VERBAL_ORDERS_NEW_NO_FACILITY_COPY,
    );
    expect(formatVerbalOrderFacilityName("  Unknown facility  ")).toBe(
      VERBAL_ORDERS_NEW_NO_FACILITY_COPY,
    );
    expect(formatVerbalOrderFacilityName("Unknown facility")).not.toBe("Unknown facility");
  });

  it("replaces legacy Unnamed and Unnamed facility copy with a named gap", () => {
    expect(formatVerbalOrderFacilityName("Unnamed")).toBe(VERBAL_ORDERS_NEW_NO_FACILITY_COPY);
    expect(formatVerbalOrderFacilityName("Unnamed facility")).toBe(
      VERBAL_ORDERS_NEW_NO_FACILITY_COPY,
    );
    expect(formatVerbalOrderFacilityName("  Unnamed facility  ")).toBe(
      VERBAL_ORDERS_NEW_NO_FACILITY_COPY,
    );
    expect(formatVerbalOrderFacilityName("Unnamed facility")).not.toBe("Unnamed facility");
  });

  it("keeps posted facility name trimmed as-is", () => {
    expect(formatVerbalOrderFacilityName("Posted Facility")).toBe("Posted Facility");
    expect(formatVerbalOrderFacilityName("  Posted Facility  ")).toBe("Posted Facility");
  });
});
