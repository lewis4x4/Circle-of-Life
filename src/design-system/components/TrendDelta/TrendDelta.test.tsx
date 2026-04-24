import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrendDelta } from "./TrendDelta";

describe("<TrendDelta />", () => {
  it("renders up arrow, value, unit, and period", () => {
    render(
      <TrendDelta direction="up" value={2.4} unit="pp" period="vs prior 7 days" />,
    );
    const badge = screen.getByLabelText(/up 2\.4pp vs prior 7 days/i);
    expect(badge).toHaveAttribute("data-direction", "up");
    expect(badge).toHaveTextContent("↑");
    expect(badge).toHaveTextContent("2.4pp");
    expect(badge).toHaveTextContent("vs prior 7 days");
  });

  it("renders down arrow with absolute value", () => {
    render(
      <TrendDelta direction="down" value={-5} unit="%" period="WoW" />,
    );
    const badge = screen.getByLabelText(/down 5% WoW/i);
    expect(badge).toHaveTextContent("↓");
    expect(badge).toHaveTextContent("5%");
  });

  it("resolves success tone when direction matches goodDirection", () => {
    render(
      <TrendDelta
        direction="up"
        value={3}
        unit="pts"
        period="MoM"
        goodDirection="up"
      />,
    );
    expect(screen.getByLabelText(/up 3pts mom/i)).toHaveAttribute("data-tone", "success");
  });

  it("resolves danger tone when direction opposes goodDirection", () => {
    render(
      <TrendDelta
        direction="up"
        value={3}
        unit="days"
        period="QoQ"
        goodDirection="down"
      />,
    );
    expect(screen.getByLabelText(/up 3days qoq/i)).toHaveAttribute("data-tone", "danger");
  });

  it("renders flat direction as muted even with goodDirection", () => {
    render(
      <TrendDelta
        direction="flat"
        value={0}
        unit="pp"
        period="vs prior 7 days"
        goodDirection="up"
      />,
    );
    expect(screen.getByLabelText(/unchanged/i)).toHaveAttribute("data-tone", "muted");
  });
});
