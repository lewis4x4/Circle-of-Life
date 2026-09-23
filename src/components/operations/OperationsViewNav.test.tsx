import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/operations/week" }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ appRole: "owner" }) }));

import { OperationsViewNav } from "./OperationsViewNav";

describe("OperationsViewNav on a phone (COL-657)", () => {
  it("is one swipeable row that wraps only from sm up, with the current view marked", () => {
    render(<OperationsViewNav />);
    const nav = screen.getByRole("navigation", { name: "Operations views" });
    const classes = nav.className.split(/\s+/);
    expect(classes).toContain("sm:flex-wrap");
    expect(classes).not.toContain("flex-wrap");
    expect(nav.closest('[data-slot="horizontal-scroll"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "Week" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });
});
