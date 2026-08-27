import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AdminBillingSettingsPage from "./page";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/billing/settings",
}));

vi.mock("../billing-hub-nav", () => ({ BillingHubNav: () => <nav aria-label="Billing sections" /> }));

describe("AdminBillingSettingsPage", () => {
  it("names the scheduling gap without calling the page a placeholder", () => {
    render(<AdminBillingSettingsPage />);

    expect(screen.getByRole("heading", { name: "Billing settings" })).toBeInTheDocument();
    expect(screen.getByText("Billing scheduling not configured")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Invoice scheduling is not live. Use overview generation, opening balances, and the rate library until it ships.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Pilot placeholder/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Automated invoice scheduling is not live in this pilot build/i),
    ).toBeInTheDocument();
  });

  it("links back to billing overview and opening balance", () => {
    render(<AdminBillingSettingsPage />);

    const overviewLinks = screen.getAllByRole("link", { name: /billing overview/i });
    expect(overviewLinks.some((link) => link.getAttribute("href") === "/admin/billing")).toBe(true);

    const openingBalanceLinks = screen.getAllByRole("link", { name: /opening balance/i });
    expect(
      openingBalanceLinks.some(
        (link) => link.getAttribute("href") === "/admin/billing/invoices/opening-balance",
      ),
    ).toBe(true);

    expect(screen.getByRole("link", { name: /rate library/i })).toHaveAttribute(
      "href",
      "/admin/billing/rates",
    );
  });
});
