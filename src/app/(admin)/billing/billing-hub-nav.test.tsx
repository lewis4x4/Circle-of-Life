import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BillingHubNav } from "./billing-hub-nav";

const mocks = vi.hoisted(() => ({ pathname: "/admin/billing" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

describe("BillingHubNav (COL-655)", () => {
  beforeEach(() => {
    mocks.pathname = "/admin/billing";
  });

  it.each([
    ["/admin/billing/collections", "Collections"],
    ["/admin/billing/collections/new", "Collections"],
    ["/admin/billing/invoices/abc", "Invoices"],
    ["/admin/billing/invoices/opening-balance", "Opening balance"],
    ["/admin/v2/billing/payments/new", "Payments"],
    ["/admin/billing", "Overview"],
  ])("lights exactly one tab on %s", (pathname, label) => {
    mocks.pathname = pathname;
    render(<BillingHubNav />);
    const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.textContent)).toEqual([label]);
  });
});
