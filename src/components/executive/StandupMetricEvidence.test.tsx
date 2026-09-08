import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StandupMetricEvidence, StandupReportingNotice } from "./StandupMetricEvidence";
import { standupQualityFixture, QUALITY_FIXTURE_TIME } from "@/test-fixtures/standup-quality";

afterEach(cleanup);

describe("standup source evidence", () => {
  it("shows partial coverage separately from calculation time and unknown source time", () => {
    const metric = standupQualityFixture().facilities[2].metrics.current_total_census;
    render(<StandupMetricEvidence metric={metric} calculatedAt={QUALITY_FIXTURE_TIME} />);
    expect(screen.getByText("Partial: 1 of 2 facilities")).toBeInTheDocument();
    expect(screen.getByText("Source details")).toHaveAttribute("aria-label", `Source details: ${metric.label}`);
    expect(screen.getByText("Source as of:").parentElement).toHaveTextContent("Unconfirmed");
    expect(screen.getByText("Calculated:").parentElement).toHaveTextContent("Sep 8, 2026");
    expect(screen.getByText(/recording coverage remains unconfirmed/)).toBeInTheDocument();
  });

  it("identifies the captured method without assigning a current method to legacy values", () => {
    const metric = standupQualityFixture().facilities[0].metrics.current_total_census;
    const v2 = { ...metric, sourceRefJson: metric.sourceRefJson.map((entry) => entry && typeof entry === "object" && entry.kind === "source_quality" ? { ...entry, basis: "haven_live_v2" } : entry) };
    const view = render(<StandupMetricEvidence metric={v2} />);
    expect(screen.getByText("Method:").parentElement).toHaveTextContent("Recorded Haven calculation v2");
    view.rerender(<StandupMetricEvidence metric={{ ...metric, sourceRefJson: [] }} />);
    expect(screen.getByText("Method:").parentElement).toHaveTextContent("Unconfirmed");
  });

  it("preserves a legacy timestamp without claiming confirmed source provenance", () => {
    const metric = { ...standupQualityFixture().facilities[0].metrics.current_total_census, sourceRefJson: [], freshnessAt: "2026-01-05T12:00:00Z" };
    render(<StandupMetricEvidence metric={metric} calculatedAt={QUALITY_FIXTURE_TIME} />);
    expect(screen.getByText("Source as of:").parentElement).toHaveTextContent("Unconfirmed");
    expect(screen.getByText(/Previously recorded timestamp/)).toHaveTextContent("Source provenance is unconfirmed");
  });

  it("does not call field population approved business definitions or complete source coverage", () => {
    render(<StandupReportingNotice />);
    expect(screen.getByRole("note")).toHaveTextContent("definitions remain TBD with Jessica");
    expect(screen.getByRole("note")).toHaveTextContent("populated fields and confidence labels do not prove complete source coverage");
  });
});
