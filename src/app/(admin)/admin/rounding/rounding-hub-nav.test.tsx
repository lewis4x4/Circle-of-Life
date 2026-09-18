import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RoundingHubNav } from "./rounding-hub-nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/rounding",
}));

/**
 * Spec 25A acceptance items 3 and 11, and defect 9.
 *
 * Nine tabs collapse to five. The negative assertions matter as much as the
 * count: a tab strip grows one tab at a time, and each of these five was once
 * somebody's obvious addition.
 */
describe("Smart Rounding tab strip", () => {
  it("has exactly five tabs", () => {
    render(<RoundingHubNav />);
    expect(screen.getAllByRole("link")).toHaveLength(5);
  });

  it("names the five surfaces the spec collapsed to", () => {
    render(<RoundingHubNav />);
    for (const label of [
      "Live board",
      "Watchlist",
      "Monitoring Orders",
      "Integrity",
      "Reports",
    ]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("lands the Live board on the hub root, with no separate overview", () => {
    render(<RoundingHubNav />);
    expect(screen.getByRole("link", { name: "Live board" })).toHaveAttribute(
      "href",
      "/admin/rounding",
    );
    expect(screen.queryByRole("link", { name: "Overview" })).toBeNull();
  });

  it("carries no tab for a workflow or a retired surface", () => {
    render(<RoundingHubNav />);
    for (const gone of ["Overview", "Escalations", "Plans", "Watches", "Safety scores", "Insights"]) {
      expect(screen.queryByRole("link", { name: gone })).toBeNull();
    }
  });

  it("says Monitoring Orders, never watches, in operator copy", () => {
    render(<RoundingHubNav />);
    const nav = screen.getByRole("navigation", { name: "Smart Rounding sections" });
    expect(nav.textContent).toContain("Monitoring Orders");
    expect(nav.textContent).not.toMatch(/\bWatches\b/);
  });
});
