import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SeverityChip } from "./SeverityChip";

describe("<SeverityChip />", () => {
  it("renders low severity without trend", () => {
    render(<SeverityChip level="low" />);
    const chip = screen.getByRole("status", { name: /severity low/i });
    expect(chip).toHaveAttribute("data-level", "low");
  });

  it("renders medium severity with label", () => {
    render(<SeverityChip level="medium" />);
    expect(screen.getByRole("status", { name: /severity medium/i })).toBeInTheDocument();
  });

  it("renders high severity with trend escalation", () => {
    render(
      <SeverityChip
        level="high"
        trend={{ from: "medium", ageText: "3d ago" }}
      />,
    );
    const chip = screen.getByRole("status", {
      name: /severity high, up from medium 3d ago/i,
    });
    expect(chip).toHaveAttribute("data-level", "high");
    expect(chip).toHaveTextContent("from Medium 3d ago");
    expect(chip).toHaveTextContent("↑");
  });

  it("renders de-escalation trend with down arrow", () => {
    render(
      <SeverityChip
        level="low"
        trend={{ from: "high", ageText: "1w ago" }}
      />,
    );
    const chip = screen.getByRole("status", { name: /down from high 1w ago/i });
    expect(chip).toHaveTextContent("↓");
  });

  it("renders unchanged arrow when trend.from equals level", () => {
    render(
      <SeverityChip
        level="medium"
        trend={{ from: "medium", ageText: "2d ago" }}
      />,
    );
    expect(
      screen.getByRole("status", { name: /unchanged from medium 2d ago/i }),
    ).toBeInTheDocument();
  });
});
