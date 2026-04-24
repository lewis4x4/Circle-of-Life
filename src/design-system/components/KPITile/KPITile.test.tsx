import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { KPITile } from "./KPITile";

describe("<KPITile />", () => {
  it("renders label, value, and unit", () => {
    render(<KPITile label="Occupancy" value={92} unit="%" info="Census / capacity" />);
    const tile = screen.getByRole("article", { name: /occupancy: 92%/i });
    expect(tile).toHaveAttribute("data-tone", "default");
    expect(tile).toHaveTextContent("92");
    expect(tile).toHaveTextContent("%");
  });

  it("becomes a button when onClick is provided", async () => {
    const handleClick = vi.fn();
    const user = userEvent.setup();
    render(
      <KPITile
        label="Alerts"
        value={7}
        info="Open alerts in scope"
        onClick={handleClick}
      />,
    );

    const tile = screen.getByRole("button", { name: /alerts: 7. open details/i });
    await user.click(tile);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("renders a trend delta when trend is provided", () => {
    render(
      <KPITile
        label="Falls"
        value={3}
        info="Falls this period"
        trend={{
          direction: "down",
          value: 2,
          unit: "pts",
          period: "vs prior 7 days",
          goodDirection: "down",
        }}
      />,
    );
    expect(screen.getByLabelText(/down 2pts vs prior 7 days/i)).toBeInTheDocument();
  });

  it("renders a sparkline when provided", () => {
    render(
      <KPITile
        label="Occupancy"
        value={92}
        info="Census / capacity"
        sparkline={[80, 82, 85, 88, 90, 91, 92]}
      />,
    );
    expect(screen.getByRole("img", { name: /occupancy sparkline trend/i })).toBeInTheDocument();
  });

  it("renders a breach message note when provided", () => {
    render(
      <KPITile
        label="Variance"
        value={14}
        unit="%"
        tone="danger"
        info="Medication variance"
        breachMessage="Above target: 14% > 8%"
      />,
    );
    expect(screen.getByRole("note")).toHaveTextContent("Above target");
  });

  it("toggles info tooltip on the info button", async () => {
    const user = userEvent.setup();
    render(<KPITile label="NPS" value={72} info="Average family NPS last 30d" />);

    const infoBtn = screen.getByRole("button", { name: /info for nps/i });
    expect(infoBtn).toHaveAttribute("aria-expanded", "false");
    await user.click(infoBtn);
    expect(infoBtn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Average family NPS last 30d");
  });

  it("applies tone-specific value color", () => {
    render(
      <KPITile label="Incidents" value={4} tone="danger" info="High-severity open" />,
    );
    expect(screen.getByRole("article")).toHaveAttribute("data-tone", "danger");
  });
});
