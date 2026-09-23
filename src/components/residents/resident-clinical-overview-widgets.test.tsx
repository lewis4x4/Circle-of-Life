import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ResidentFallRiskPresentation, hasFallRiskAssessment } from "./resident-clinical-overview-widgets";

describe("ResidentFallRiskPresentation", () => {
  it("keeps an absent fall-risk review unknown", () => {
    render(<ResidentFallRiskPresentation raw={null} />);
    expect(screen.getByText("Not reviewed")).toBeInTheDocument();
    expect(screen.queryByText("Standard baseline")).not.toBeInTheDocument();
  });

  it("shows the standard baseline only when it is explicitly stored", () => {
    render(<ResidentFallRiskPresentation raw="standard" />);
    expect(screen.getByText("Standard baseline")).toBeInTheDocument();
  });

  it("does not call the old column default a standard baseline when no Morse Fall is on file (COL-649)", () => {
    render(<ResidentFallRiskPresentation raw="standard" assessed={hasFallRiskAssessment([{ assessmentType: "katz_adl" }])} />);
    expect(screen.queryByText("Standard baseline")).not.toBeInTheDocument();
    expect(screen.getByText("Not assessed — no Morse Fall on file")).toBeInTheDocument();
  });

  it("shows the standard baseline when a Morse Fall is on file", () => {
    render(<ResidentFallRiskPresentation raw="standard" assessed={hasFallRiskAssessment([{ assessmentType: "morse_fall" }])} />);
    expect(screen.getByText("Standard baseline")).toBeInTheDocument();
  });

  it("keeps elevated risk visible even without an assessment", () => {
    render(<ResidentFallRiskPresentation raw="high" assessed={false} />);
    expect(screen.getByText("High fall risk")).toBeInTheDocument();
  });
});
