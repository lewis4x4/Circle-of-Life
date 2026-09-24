import { describe, expect, it } from "vitest";

import {
  AUDIT_EXPORT_NO_FACILITY_NAME_COPY,
  AUDIT_EXPORT_NO_ROW_COUNT_COPY,
  AUDIT_EXPORT_OPEN_DATE_RANGE_COPY,
  formatAuditExportJobDateRange,
  formatAuditExportRowCount,
  formatAuditExportScopeFacilityName,
} from "./audit-export-display-copy";

describe("formatAuditExportRowCount", () => {
  it("returns explicit copy when row count is missing", () => {
    expect(formatAuditExportRowCount(null)).toBe(AUDIT_EXPORT_NO_ROW_COUNT_COPY);
    expect(formatAuditExportRowCount(undefined)).toBe(AUDIT_EXPORT_NO_ROW_COUNT_COPY);
  });

  it("keeps real zero as numeric zero", () => {
    expect(formatAuditExportRowCount(0)).toBe(0);
  });

  it("returns posted counts unchanged", () => {
    expect(formatAuditExportRowCount(42)).toBe(42);
  });
});

describe("formatAuditExportJobDateRange", () => {
  it("names an open date range when both bounds are absent", () => {
    expect(formatAuditExportJobDateRange(null, null)).toBe(AUDIT_EXPORT_OPEN_DATE_RANGE_COPY);
  });

  it("keeps partial ranges visible", () => {
    expect(formatAuditExportJobDateRange("2026-08-01", null)).toBe("2026-08-01 → …");
    expect(formatAuditExportJobDateRange(null, "2026-08-31")).toBe("… → 2026-08-31");
  });
});

describe("formatAuditExportScopeFacilityName", () => {
  it("returns a posted facility name trimmed", () => {
    expect(formatAuditExportScopeFacilityName("Anon Facility A")).toBe("Anon Facility A");
    expect(formatAuditExportScopeFacilityName("  Anon Facility A  ")).toBe("Anon Facility A");
  });

  it("names the gap without the selected facility when the name is missing", () => {
    expect(formatAuditExportScopeFacilityName(null)).toBe(AUDIT_EXPORT_NO_FACILITY_NAME_COPY);
    expect(formatAuditExportScopeFacilityName(undefined)).toBe(AUDIT_EXPORT_NO_FACILITY_NAME_COPY);
    expect(formatAuditExportScopeFacilityName("")).toBe(AUDIT_EXPORT_NO_FACILITY_NAME_COPY);
    expect(formatAuditExportScopeFacilityName("   ")).toBe(AUDIT_EXPORT_NO_FACILITY_NAME_COPY);
    expect(formatAuditExportScopeFacilityName(null)).not.toMatch(/selected facility/i);
  });
});

