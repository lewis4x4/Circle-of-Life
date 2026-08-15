import { describe, expect, it } from "vitest";

import {
  OPERATIONS_NO_FACILITY_COPY,
  OPERATIONS_NO_MISSED_AT_COPY,
  formatOperationsFacilityName,
  formatOperationsMissedAt,
} from "./operations-display-copy";

const EM_DASH = "—";
const POSTED_FACILITY_NAME = "Posted Facility";

describe("formatOperationsFacilityName", () => {
  it("names the gap when facility name is missing", () => {
    expect(formatOperationsFacilityName(null)).toBe(OPERATIONS_NO_FACILITY_COPY);
    expect(formatOperationsFacilityName(undefined)).toBe(OPERATIONS_NO_FACILITY_COPY);
    expect(formatOperationsFacilityName(null)).not.toBe(EM_DASH);
  });

  it("names the gap when facility name is blank", () => {
    expect(formatOperationsFacilityName("")).toBe(OPERATIONS_NO_FACILITY_COPY);
    expect(formatOperationsFacilityName("   ")).toBe(OPERATIONS_NO_FACILITY_COPY);
    expect(formatOperationsFacilityName("")).not.toBe(EM_DASH);
  });

  it("names the gap when facility name is an em dash", () => {
    expect(formatOperationsFacilityName(EM_DASH)).toBe(OPERATIONS_NO_FACILITY_COPY);
    expect(formatOperationsFacilityName(`  ${EM_DASH}  `)).toBe(OPERATIONS_NO_FACILITY_COPY);
    expect(formatOperationsFacilityName(EM_DASH)).not.toBe(EM_DASH);
  });

  it("replaces legacy Unknown, Unknown facility, and Unknown Facility copy with a named gap", () => {
    expect(formatOperationsFacilityName("Unknown")).toBe(OPERATIONS_NO_FACILITY_COPY);
    expect(formatOperationsFacilityName("  Unknown  ")).toBe(OPERATIONS_NO_FACILITY_COPY);
    expect(formatOperationsFacilityName("Unknown facility")).toBe(OPERATIONS_NO_FACILITY_COPY);
    expect(formatOperationsFacilityName("  Unknown facility  ")).toBe(OPERATIONS_NO_FACILITY_COPY);
    expect(formatOperationsFacilityName("Unknown Facility")).toBe(OPERATIONS_NO_FACILITY_COPY);
    expect(formatOperationsFacilityName("  Unknown Facility  ")).toBe(OPERATIONS_NO_FACILITY_COPY);
    expect(formatOperationsFacilityName("Unknown Facility")).not.toBe("Unknown Facility");
  });

  it("replaces legacy Unnamed and Unnamed facility copy with a named gap", () => {
    expect(formatOperationsFacilityName("Unnamed")).toBe(OPERATIONS_NO_FACILITY_COPY);
    expect(formatOperationsFacilityName("Unnamed facility")).toBe(OPERATIONS_NO_FACILITY_COPY);
    expect(formatOperationsFacilityName("  Unnamed facility  ")).toBe(OPERATIONS_NO_FACILITY_COPY);
    expect(formatOperationsFacilityName("Unnamed facility")).not.toBe("Unnamed facility");
  });

  it("keeps posted facility name trimmed as-is", () => {
    expect(formatOperationsFacilityName(POSTED_FACILITY_NAME)).toBe(POSTED_FACILITY_NAME);
    expect(formatOperationsFacilityName(`  ${POSTED_FACILITY_NAME}  `)).toBe(POSTED_FACILITY_NAME);
  });
});

const POSTED_MISSED_AT_ISO = "2026-01-15T14:30:00.000Z";

describe("formatOperationsMissedAt", () => {
  it("names the gap when missed_at is missing", () => {
    expect(formatOperationsMissedAt(null)).toBe(OPERATIONS_NO_MISSED_AT_COPY);
    expect(formatOperationsMissedAt(undefined)).toBe(OPERATIONS_NO_MISSED_AT_COPY);
    expect(formatOperationsMissedAt(null)).not.toBe(EM_DASH);
  });

  it("names the gap when missed_at is blank or em dash", () => {
    expect(formatOperationsMissedAt("")).toBe(OPERATIONS_NO_MISSED_AT_COPY);
    expect(formatOperationsMissedAt("   ")).toBe(OPERATIONS_NO_MISSED_AT_COPY);
    expect(formatOperationsMissedAt(EM_DASH)).toBe(OPERATIONS_NO_MISSED_AT_COPY);
    expect(formatOperationsMissedAt(`  ${EM_DASH}  `)).toBe(OPERATIONS_NO_MISSED_AT_COPY);
    expect(formatOperationsMissedAt("")).not.toBe(EM_DASH);
  });

  it("names the gap when missed_at is unparseable", () => {
    expect(formatOperationsMissedAt("not-a-timestamp")).toBe(OPERATIONS_NO_MISSED_AT_COPY);
    expect(formatOperationsMissedAt("not-a-timestamp")).not.toBe(EM_DASH);
  });

  it("keeps posted missed_at as toLocaleString", () => {
    const expected = new Date(POSTED_MISSED_AT_ISO).toLocaleString();
    expect(formatOperationsMissedAt(POSTED_MISSED_AT_ISO)).toBe(expected);
    expect(formatOperationsMissedAt(`  ${POSTED_MISSED_AT_ISO}  `)).toBe(expected);
  });
});
