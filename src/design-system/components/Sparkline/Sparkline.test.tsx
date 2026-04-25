import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Sparkline } from "./Sparkline";

describe("<Sparkline />", () => {
  it("renders as an img with default aria-label", () => {
    render(<Sparkline data={[1, 2, 3, 4, 5, 6, 7]} />);
    const chart = screen.getByRole("img");
    expect(chart).toHaveAttribute("aria-label", "Sparkline trend chart");
    expect(chart).toHaveAttribute("data-tone", "default");
  });

  it("accepts a custom aria-label and tone", () => {
    render(
      <Sparkline
        data={[5, 5, 5, 5, 5, 5, 5]}
        tone="success"
        ariaLabel="Occupancy trend"
      />,
    );
    const chart = screen.getByRole("img", { name: /occupancy trend/i });
    expect(chart).toHaveAttribute("data-tone", "success");
  });

  it("renders an empty placeholder when data is empty", () => {
    render(<Sparkline data={[]} />);
    const chart = screen.getByRole("img");
    expect(chart.querySelector("span[aria-hidden='true']")).not.toBeNull();
  });

  it("doubles a single point to avoid zero-length series", () => {
    render(<Sparkline data={[42]} ariaLabel="single" />);
    const chart = screen.getByRole("img", { name: /single/i });
    expect(chart).toBeInTheDocument();
  });
});
