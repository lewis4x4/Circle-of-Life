import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ appRole: "med_tech", user: null, loading: false }),
}));

import { FloorWorkflowStrip } from "./FloorWorkflowStrip";

describe("FloorWorkflowStrip on a phone (COL-657)", () => {
  it("is one swipeable row with the advice sentence kept for wider screens", () => {
    render(<FloorWorkflowStrip active="meds" title="Medication pass" description="Scan, confirm, record." />);
    const nav = screen.getByRole("navigation", { name: "Floor workflows" });
    expect(nav.className).toContain("overflow-x-auto");
    expect(nav.className).toContain("sm:flex-wrap");
    expect(nav.className).not.toMatch(/(^|\s)flex-wrap(\s|$)/);
    const advice = screen.getByText("Scan, confirm, record.").className.split(/\s+/);
    expect(advice).toEqual(expect.arrayContaining(["hidden", "sm:block"]));
  });

  it("marks the current workflow", () => {
    render(<FloorWorkflowStrip active="rounds" title="Rounds" description="Walk the hall." />);
    expect(screen.getByRole("link", { name: "Rounds" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Medication pass" })).not.toHaveAttribute("aria-current");
  });
});
