import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HealthDot } from "./HealthDot";
import { HEALTH_DOT_BANDS, resolveHealthBand } from "./bands";

describe("resolveHealthBand", () => {
  it("exports the canonical band thresholds", () => {
    expect(HEALTH_DOT_BANDS).toEqual([
      { min: 80, tone: "success" },
      { min: 65, tone: "warning" },
      { min: 0, tone: "danger" },
    ]);
  });

  it("maps scores to tones across band boundaries", () => {
    expect(resolveHealthBand(100)).toBe("success");
    expect(resolveHealthBand(80)).toBe("success");
    expect(resolveHealthBand(79)).toBe("warning");
    expect(resolveHealthBand(65)).toBe("warning");
    expect(resolveHealthBand(64)).toBe("danger");
    expect(resolveHealthBand(0)).toBe("danger");
  });

  it("respects custom max values", () => {
    expect(resolveHealthBand(8, 10)).toBe("success");
    expect(resolveHealthBand(7, 10)).toBe("warning");
    expect(resolveHealthBand(5, 10)).toBe("danger");
  });
});

describe("<HealthDot />", () => {
  it("renders a healthy score with success tone", () => {
    render(<HealthDot score={92} />);
    const chart = screen.getByRole("img", { name: /health score 92 of 100/i });
    expect(chart).toHaveAttribute("data-tone", "success");
    expect(chart).toHaveTextContent("92");
  });

  it("renders warning band", () => {
    render(<HealthDot score={72} />);
    expect(screen.getByRole("img")).toHaveAttribute("data-tone", "warning");
  });

  it("renders danger band", () => {
    render(<HealthDot score={40} />);
    expect(screen.getByRole("img")).toHaveAttribute("data-tone", "danger");
  });

  it("clamps negative or over-range scores", () => {
    render(<HealthDot score={-10} ariaLabel="clamped-low" />);
    expect(screen.getByLabelText("clamped-low")).toHaveTextContent("0");
  });

  it("supports custom max values", () => {
    render(<HealthDot score={9} max={10} ariaLabel="ten-scale" />);
    const chart = screen.getByLabelText("ten-scale");
    expect(chart).toHaveAttribute("data-tone", "success");
    expect(chart).toHaveTextContent("9");
  });
});
