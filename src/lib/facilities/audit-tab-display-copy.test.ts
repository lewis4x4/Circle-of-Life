import { describe, expect, it } from "vitest";

import {
  AUDIT_TAB_NO_NEW_VALUE_COPY,
  AUDIT_TAB_NO_PREVIOUS_VALUE_COPY,
  AUDIT_STRIP_NO_LAST_EVENT_COPY,
  AUDIT_STRIP_NO_TOP_USER_COPY,
  formatAuditStripLastEventRelative,
  formatAuditStripTopUserDisplay,
  formatAuditTabLastEventRelative,
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

describe("formatAuditTabLastEventRelative", () => {
  it("names a missing last event instead of an em dash", () => {
    expect(formatAuditTabLastEventRelative(null)).toBe(AUDIT_STRIP_NO_LAST_EVENT_COPY);
    expect(formatAuditTabLastEventRelative(undefined)).toBe(AUDIT_STRIP_NO_LAST_EVENT_COPY);
    expect(formatAuditTabLastEventRelative("")).toBe(AUDIT_STRIP_NO_LAST_EVENT_COPY);
    expect(formatAuditTabLastEventRelative("   ")).toBe(AUDIT_STRIP_NO_LAST_EVENT_COPY);
    expect(formatAuditTabLastEventRelative("not-a-date")).toBe(AUDIT_STRIP_NO_LAST_EVENT_COPY);
    expect(formatAuditTabLastEventRelative(null)).not.toBe(EM_DASH);
  });

  it("returns a non-empty relative phrase when a posted ISO timestamp exists", () => {
    const relative = formatAuditTabLastEventRelative("2026-01-01T12:00:00.000Z");
    expect(relative).toBeTruthy();
    expect(relative).not.toBe(EM_DASH);
    expect(relative).not.toBe(AUDIT_STRIP_NO_LAST_EVENT_COPY);
  });
});

describe("formatAuditStripLastEventRelative", () => {
  it("names a missing last event instead of an em dash", () => {
    expect(formatAuditStripLastEventRelative(null, "")).toBe(AUDIT_STRIP_NO_LAST_EVENT_COPY);
    expect(formatAuditStripLastEventRelative(new Date("invalid"), "2 days ago")).toBe(
      AUDIT_STRIP_NO_LAST_EVENT_COPY,
    );
    expect(formatAuditStripLastEventRelative(null, "")).not.toBe(EM_DASH);
  });

  it("returns a formatted relative time when an event exists", () => {
    const last = new Date("2026-01-01T12:00:00.000Z");
    expect(formatAuditStripLastEventRelative(last, "3 days ago")).toBe("3 days ago");
  });
});

describe("formatAuditStripTopUserDisplay", () => {
  it("names missing activity instead of an em dash when there are zero events", () => {
    expect(formatAuditStripTopUserDisplay(null, 0)).toBe(AUDIT_STRIP_NO_TOP_USER_COPY);
    expect(formatAuditStripTopUserDisplay("   ", 0)).toBe(AUDIT_STRIP_NO_TOP_USER_COPY);
    expect(formatAuditStripTopUserDisplay(null, 0)).not.toBe(EM_DASH);
  });

  it("keeps real zero event counts numeric while naming missing top user", () => {
    expect(formatAuditStripTopUserDisplay(null, 0)).toBe(AUDIT_STRIP_NO_TOP_USER_COPY);
    expect(formatAuditStripTopUserDisplay(null, 3)).toBe("Service session actors");
  });

  it("returns a posted top user trimmed", () => {
    expect(formatAuditStripTopUserDisplay("  Jane Operator  ", 2)).toBe("Jane Operator");
  });
});
