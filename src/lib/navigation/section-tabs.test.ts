import { describe, expect, it } from "vitest";

import { activeSectionTabHref } from "./section-tabs";

const BILLING = ["/admin/billing", "/admin/billing/invoices", "/admin/billing/invoices/opening-balance", "/admin/billing/collections"];

describe("activeSectionTabHref (COL-655)", () => {
  it.each([
    ["/admin/billing", "/admin/billing"],
    ["/admin/billing/invoices/abc", "/admin/billing/invoices"],
    ["/admin/billing/invoices/opening-balance", "/admin/billing/invoices/opening-balance"],
    ["/admin/billing/collections/new", "/admin/billing/collections"],
    ["/admin/v2/billing/invoices", "/admin/billing/invoices"],
    ["/admin/billing/settings", null],
    ["/admin/billingx", null],
  ])("%s → %s", (pathname, expected) => {
    expect(activeSectionTabHref(pathname, BILLING)).toBe(expected);
  });
});
