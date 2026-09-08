import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExecutiveHubNav } from "./executive-hub-nav";

const mocks = vi.hoisted(() => ({ pathname: "/admin/executive", appRole: "owner", loading: false }));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => mocks }));

async function openSections() {
  const trigger = screen.getByRole("button", { name: "Open executive intelligence sections" });
  trigger.focus();
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  return within(await screen.findByRole("dialog", { name: "Executive intelligence" }));
}

describe("ExecutiveHubNav", () => {
  beforeEach(() => {
    mocks.pathname = "/admin/executive";
    mocks.appRole = "owner";
    mocks.loading = false;
  });

  it("keeps primary links focusable and marks Overview only on its exact route", () => {
    render(<ExecutiveHubNav />);
    const overview = screen.getByRole("link", { name: "Overview" });
    const standup = screen.getByRole("link", { name: "Standup" });
    expect(overview).toHaveAttribute("aria-current", "page");
    expect(standup.tabIndex).toBe(0);
    standup.focus();
    expect(standup).toHaveFocus();
    expect(standup).toHaveAttribute("href", "/admin/executive/standup");
  });

  it.each([
    ["/admin/executive", "Overview"],
    ["/admin/executive/alerts", "Alerts"],
    ["/admin/executive/standup/history", "Standup history"],
    ["/admin/executive/standup/history/older", "Standup history"],
    ["/admin/executive/standup/compare", "Standup compare"],
  ])("opens the real mobile drawer on %s with exactly one current destination", async (pathname, currentLabel) => {
    mocks.pathname = pathname;
    render(<ExecutiveHubNav />);
    const drawer = await openSections();
    const current = drawer.getAllByRole("link", { current: "page" });
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName(currentLabel);
    for (const link of drawer.getAllByRole("link")) expect(link.tabIndex).toBe(0);
    const overview = drawer.getByRole("link", { name: "Overview" });
    if (pathname !== "/admin/executive") expect(overview).not.toHaveAttribute("aria-current");
  });

  it("does not mark Overview current on an unmatched executive child", async () => {
    mocks.pathname = "/admin/executive/facility/a";
    render(<ExecutiveHubNav />);
    const drawer = await openSections();
    expect(drawer.queryAllByRole("link", { current: "page" })).toHaveLength(0);
  });

  it("does not mark the desktop Standup parent current when history is selected", () => {
    mocks.pathname = "/admin/executive/standup/history";
    render(<ExecutiveHubNav />);
    expect(screen.getByRole("link", { name: "Standup" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "More views — currently Standup history" })).toBeVisible();
  });

  it("restricts desktop and mobile links to the facility admin's permitted destinations", async () => {
    mocks.appRole = "facility_admin";
    mocks.pathname = "/admin/executive/standup/history";
    render(<ExecutiveHubNav />);
    expect(screen.queryByRole("link", { name: "Overview" })).not.toBeInTheDocument();
    const drawer = await openSections();
    expect(drawer.getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Standup", "Standup history", "Standup compare",
    ]);
    expect(drawer.getAllByRole("link", { current: "page" })).toHaveLength(1);
    expect(drawer.getByRole("link", { current: "page" })).toHaveAccessibleName("Standup history");
  });

  it("offers no executive destinations to a role without executive access", async () => {
    mocks.appRole = "caregiver";
    render(<ExecutiveHubNav />);
    const drawer = await openSections();
    expect(drawer.queryAllByRole("link")).toHaveLength(0);
  });
});
