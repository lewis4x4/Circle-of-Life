import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ExecutiveHubNav } from "./executive-hub-nav";

const mocks = vi.hoisted(() => ({ pathname: "/admin/executive" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ appRole: "owner", loading: false }),
}));

describe("ExecutiveHubNav", () => {
  it("keeps each primary route link in the normal tab order and marks the active page", () => {
    render(<ExecutiveHubNav />);

    const overview = screen.getByRole("link", { name: "Overview" });
    const standup = screen.getByRole("link", { name: "Standup" });

    expect(overview).toHaveAttribute("aria-current", "page");
    expect(standup).not.toHaveAttribute("tabindex", "-1");
    expect(standup).toHaveAttribute("href", "/admin/executive/standup");
  });

  it("renders the mobile sections trigger from the same responsive navigation", () => {
    render(<ExecutiveHubNav />);

    expect(screen.getByRole("button", { name: "Open executive intelligence sections" })).toBeVisible();
  });
});
