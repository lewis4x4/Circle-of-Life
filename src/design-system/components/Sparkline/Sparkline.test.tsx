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

  it("renders inline svg paths for multi-point data", () => {
    render(<Sparkline data={[1, 3, 2, 4]} ariaLabel="multi" />);
    const chart = screen.getByRole("img", { name: /multi/i });
    expect(chart.querySelector("svg")).not.toBeNull();
    const paths = chart.querySelectorAll("path");
    expect(paths).toHaveLength(2);
    paths.forEach((path) => {
      expect(path.getAttribute("d")).toBeTruthy();
    });
    expect(chart.querySelector(".recharts-wrapper")).toBeNull();
  });

  it("renders an empty placeholder when data is empty", () => {
    render(<Sparkline data={[]} />);
    const chart = screen.getByRole("img");
    expect(chart.querySelector("span[aria-hidden='true']")).not.toBeNull();
    expect(chart.querySelector(".recharts-wrapper")).toBeNull();
  });

  it("ignores invalid numeric values instead of emitting invalid svg paths", () => {
    render(<Sparkline data={[1, Number.NaN, Number.POSITIVE_INFINITY, 3]} ariaLabel="safe" />);
    const chart = screen.getByRole("img", { name: /safe/i });
    chart.querySelectorAll("path").forEach((path) => {
      expect(path.getAttribute("d")).not.toMatch(/NaN|Infinity/);
    });
  });

  it("doubles a single point and still renders non-empty svg paths", () => {
    render(<Sparkline data={[42]} ariaLabel="single" />);
    const chart = screen.getByRole("img", { name: /single/i });
    const svg = chart.querySelector("svg");
    expect(svg).not.toBeNull();
    const paths = chart.querySelectorAll("path");
    expect(paths).toHaveLength(2);
    paths.forEach((path) => {
      expect(path.getAttribute("d")).toBeTruthy();
    });
    expect(chart.querySelector(".recharts-wrapper")).toBeNull();
  });
});
