import { describe, expect, it } from "vitest";

import { INVOICE_NO_UPDATED_AT_COPY, formatUpdatedAt } from "./invoices-display-copy";

const EM_DASH = "—";

describe("formatUpdatedAt", () => {
  it("names the gap when updated-at is unparseable", () => {
    expect(formatUpdatedAt("not-a-date")).toBe(INVOICE_NO_UPDATED_AT_COPY);
    expect(formatUpdatedAt("")).toBe(INVOICE_NO_UPDATED_AT_COPY);
    expect(formatUpdatedAt("not-a-date")).not.toBe(EM_DASH);
  });

  it("formats a posted ISO timestamp with en-US month, day, hour, and minute", () => {
    const formatted = formatUpdatedAt("2026-05-20T14:05:00Z");
    expect(formatted).toMatch(/May/);
    expect(formatted).toMatch(/20/);
    expect(formatted).not.toBe(INVOICE_NO_UPDATED_AT_COPY);
    expect(formatted).not.toBe(EM_DASH);
  });
});
