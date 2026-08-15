import { describe, expect, it } from "vitest";

import {
  AUDIT_TAB_NO_NEW_VALUE_COPY,
  AUDIT_TAB_NO_PREVIOUS_VALUE_COPY,
  formatAuditTabNewValue,
  formatAuditTabOldValue,
} from "./audit-tab-display-copy";

const EM_DASH = "—";

describe("formatAuditTabOldValue", () => {
  it("names a missing previous value instead of an em dash", () => {
    expect(formatAuditTabOldValue(null)).toBe(AUDIT_TAB_NO_PREVIOUS_VALUE_COPY);
    expect(formatAuditTabOldValue(undefined)).toBe(AUDIT_TAB_NO_PREVIOUS_VALUE_COPY);
    expect(formatAuditTabOldValue("")).toBe(AUDIT_TAB_NO_PREVIOUS_VALUE_COPY);
    expect(formatAuditTabOldValue("   ")).toBe(AUDIT_TAB_NO_PREVIOUS_VALUE_COPY);
    expect(formatAuditTabOldValue(EM_DASH)).toBe(AUDIT_TAB_NO_PREVIOUS_VALUE_COPY);
    expect(formatAuditTabOldValue(null)).not.toBe(EM_DASH);
  });

  it("returns a posted previous value trimmed", () => {
    expect(formatAuditTabOldValue("  42  ")).toBe("42");
  });
});

describe("formatAuditTabNewValue", () => {
  it("names a missing new value instead of an em dash", () => {
    expect(formatAuditTabNewValue(null)).toBe(AUDIT_TAB_NO_NEW_VALUE_COPY);
    expect(formatAuditTabNewValue(undefined)).toBe(AUDIT_TAB_NO_NEW_VALUE_COPY);
    expect(formatAuditTabNewValue("")).toBe(AUDIT_TAB_NO_NEW_VALUE_COPY);
    expect(formatAuditTabNewValue("   ")).toBe(AUDIT_TAB_NO_NEW_VALUE_COPY);
    expect(formatAuditTabNewValue(EM_DASH)).toBe(AUDIT_TAB_NO_NEW_VALUE_COPY);
    expect(formatAuditTabNewValue(null)).not.toBe(EM_DASH);
  });

  it("returns a posted new value trimmed", () => {
    expect(formatAuditTabNewValue("  enabled  ")).toBe("enabled");
  });
});
