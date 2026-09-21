import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BillingHubNav } from "./billing-hub-nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/billing/invoices",
}));

describe("BillingHubNav", () => {
  it("contains destinations only and leaves opening-balance entry to the invoice workflow", () => {
    render(<BillingHubNav />);

    expect(screen.getByRole("link", { name: "Invoices" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Opening balance" })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(7);
  });
});
