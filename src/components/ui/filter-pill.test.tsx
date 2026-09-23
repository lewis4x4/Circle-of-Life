import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FilterPill } from "./filter-pill";

describe("FilterPill", () => {
  it("renders no count badge and neutral chrome when the count is unknown", () => {
    render(<FilterPill label="Overdue" tone="danger" />);
    const pill = screen.getByRole("button", { name: "Overdue" });
    expect(pill.textContent).toBe("Overdue");
    expect(pill.className).not.toMatch(/destructive/);
  });

  it("shows a real count and tone when there is one", () => {
    render(<FilterPill label="Overdue" tone="danger" count={3} />);
    const pill = screen.getByRole("button", { name: /Overdue/ });
    expect(pill.textContent).toContain("(3)");
    expect(pill.className).toMatch(/destructive/);
  });

  it("keeps a real zero muted", () => {
    render(<FilterPill label="Overdue" tone="danger" count={0} />);
    const pill = screen.getByRole("button", { name: /Overdue/ });
    expect(pill.textContent).toContain("(0)");
    expect(pill.className).not.toMatch(/destructive/);
  });
});
