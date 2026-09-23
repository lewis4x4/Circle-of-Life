import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import { FacilityAuditMetricsStrip } from "./FacilityAuditMetricsStrip";

const renderStrip = (metrics: Parameters<typeof FacilityAuditMetricsStrip>[0]["metrics"]) =>
  render(
    <TooltipProvider>
      <FacilityAuditMetricsStrip loading={false} metrics={metrics} retentionCopy="Kept for the retention period." />
    </TooltipProvider>,
  );

describe("FacilityAuditMetricsStrip (COL-708)", () => {
  it("says Unavailable on every tile when the metrics read failed, not 0 events or a default 7 yr", () => {
    renderStrip(null);
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText(/7 yr/)).toBeNull();
  });

  it("shows real figures, including a real zero", () => {
    renderStrip({
      events_last_7d: 0,
      events_all_time: 40,
      last_event_at: null,
      top_user_display: null,
      retention_years: 10,
    });
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.getByText("10 yr")).toBeTruthy();
  });
});
