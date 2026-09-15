import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ResidentFallRiskPresentation } from "./resident-clinical-overview-widgets";

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
});
