import { describe, expect, it } from "vitest";

import {
  VENDORS_TAB_NO_LAST_ACTIVITY_COPY,
  VENDORS_TAB_NO_PHONE_COPY,
  formatVendorsTabLastActivityDisplay,
  formatVendorsTabPhoneDisplay,
} from "./vendors-tab-display-copy";

const EM_DASH = "—";

describe("formatVendorsTabPhoneDisplay", () => {
  it("names a missing phone instead of an em dash", () => {
    expect(formatVendorsTabPhoneDisplay(null)).toBe(VENDORS_TAB_NO_PHONE_COPY);
    expect(formatVendorsTabPhoneDisplay(undefined)).toBe(VENDORS_TAB_NO_PHONE_COPY);
    expect(formatVendorsTabPhoneDisplay("")).toBe(VENDORS_TAB_NO_PHONE_COPY);
    expect(formatVendorsTabPhoneDisplay("   ")).toBe(VENDORS_TAB_NO_PHONE_COPY);
    expect(formatVendorsTabPhoneDisplay(null)).not.toBe(EM_DASH);
  });

  it("returns a posted phone trimmed", () => {
    expect(formatVendorsTabPhoneDisplay("  (352) 555-0100  ")).toBe("(352) 555-0100");
  });
});

describe("formatVendorsTabLastActivityDisplay", () => {
  it("names missing invoice and payment timestamps instead of an em dash", () => {
    expect(formatVendorsTabLastActivityDisplay(null, null)).toBe(VENDORS_TAB_NO_LAST_ACTIVITY_COPY);
    expect(formatVendorsTabLastActivityDisplay(undefined, undefined)).toBe(VENDORS_TAB_NO_LAST_ACTIVITY_COPY);
    expect(formatVendorsTabLastActivityDisplay(null, null)).not.toBe(EM_DASH);
  });

  it("formats a posted invoice timestamp", () => {
    const formatted = formatVendorsTabLastActivityDisplay("2026-03-15T12:00:00.000Z", null);
    expect(formatted).toBe(new Date("2026-03-15T12:00:00.000Z").toLocaleDateString(undefined, { dateStyle: "medium" }));
    expect(formatted).not.toBe(VENDORS_TAB_NO_LAST_ACTIVITY_COPY);
  });

  it("falls back to payment timestamp when invoice is missing", () => {
    const formatted = formatVendorsTabLastActivityDisplay(null, "2026-01-10T08:00:00.000Z");
    expect(formatted).toBe(new Date("2026-01-10T08:00:00.000Z").toLocaleDateString(undefined, { dateStyle: "medium" }));
  });
});
