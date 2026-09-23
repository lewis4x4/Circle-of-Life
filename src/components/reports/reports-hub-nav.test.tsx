import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReportsHubNav } from "./reports-hub-nav";

const mocks = vi.hoisted(() => ({ pathname: "/admin/reports" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

function currentLabels() {
  return [...new Set(screen.queryAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.textContent?.trim()))];
}

describe("ReportsHubNav run pages (COL-655)", () => {
  beforeEach(() => {
    mocks.pathname = "/admin/reports";
  });

  it.each([
    ["/admin/reports/run/template/census", "Templates"],
    ["/admin/reports/run/pack/5f0c4b8e-0000-4000-8000-000000000001", "Packs"],
  ])("lights the source tab, not History, on %s", (pathname, label) => {
    mocks.pathname = pathname;
    render(<ReportsHubNav />);
    expect(currentLabels()).toEqual([label]);
  });

  it("still lights History on a history record", () => {
    mocks.pathname = "/admin/reports/history/abc";
    render(<ReportsHubNav />);
    expect(currentLabels()).toEqual(["History"]);
  });
});
