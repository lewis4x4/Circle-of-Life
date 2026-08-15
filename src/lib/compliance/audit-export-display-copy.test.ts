import { describe, expect, it } from "vitest";

import {
  AUDIT_EXPORT_NO_ROW_COUNT_COPY,
  formatAuditExportRowCount,
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
