import { describe, expect, it } from "vitest";

import { FACILITY_AUDIT_NO_VALUE_COPY } from "./facility-audit-display-copy";
import { formatAuditJsonCell } from "./facility-audit-ui";

const PLACEHOLDER_STRING = "license_status";
const PLACEHOLDER_OBJECT = { field_key: "rate_cents", posted_value: 0 };

describe("formatAuditJsonCell", () => {
  it("names missing value instead of a silent dash", () => {
    expect(formatAuditJsonCell(null)).toBe(FACILITY_AUDIT_NO_VALUE_COPY);
    expect(formatAuditJsonCell(undefined)).toBe(FACILITY_AUDIT_NO_VALUE_COPY);
  });

  it("returns posted strings as-is", () => {
    expect(formatAuditJsonCell(PLACEHOLDER_STRING)).toBe(PLACEHOLDER_STRING);
    expect(formatAuditJsonCell("")).toBe("");
  });

  it("stringifies posted objects and keeps numeric zero", () => {
    expect(formatAuditJsonCell(PLACEHOLDER_OBJECT)).toBe(JSON.stringify(PLACEHOLDER_OBJECT));
    expect(formatAuditJsonCell(0)).toBe("0");
  });
});
